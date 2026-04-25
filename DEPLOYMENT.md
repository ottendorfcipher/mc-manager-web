# Deployment Guide - redstoneCipher

Complete deployment steps for the redstoneCipher Minecraft management portal.

## Architecture Overview

```
Firebase Hosting (Frontend)
    ↓ rewrites /api/** and /auth/**
Cloud Run (Backend API)
    ↓ connects via Tailscale
Minecraft Server VM (GCP Compute Engine)
```

**Budget Protection:**
- Cloud Function monitors spending
- Automatically shuts down at $8/month threshold
- Prevents runaway costs

---

## Initial Setup (One-Time)

### 1. Prerequisites
- Google Cloud SDK installed and authenticated
- Firebase CLI installed: `npm install -g firebase-tools`
- Node.js 22+ and Rust 1.88+
- Access to billing account `01D611-3D5E81-CECCE6`

### 2. Enable Required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudfunctions.googleapis.com \
  pubsub.googleapis.com \
  --project=redstonecipher-web
```

### 3. Create Artifact Registry
```bash
gcloud artifacts repositories create app \
  --repository-format=docker \
  --location=us-central1 \
  --project=redstonecipher-web
```

### 4. Create Service Account
```bash
gcloud iam service-accounts create redstonecipher-sa \
  --display-name="redstoneCipher Service Account" \
  --project=redstonecipher-web

# Grant permissions
gcloud projects add-iam-policy-binding redstonecipher-web \
  --member="serviceAccount:redstonecipher-sa@redstonecipher-web.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding redstonecipher-web \
  --member="serviceAccount:redstonecipher-sa@redstonecipher-web.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

### 5. Create Pub/Sub Topic for Budget Alerts
```bash
gcloud pubsub topics create redstonecipher-budget-alerts \
  --project=redstonecipher-web
```

### 6. Store Secrets in Secret Manager
```bash
# JWT secret
echo -n "your-jwt-secret" | \
  gcloud secrets create jwt_secret --data-file=- --project=redstonecipher-web

# Google OAuth credentials
echo -n "your-client-id" | \
  gcloud secrets create google_client_id --data-file=- --project=redstonecipher-web

echo -n "your-client-secret" | \
  gcloud secrets create google_client_secret --data-file=- --project=redstonecipher-web

# Budget webhook token
echo -n "your-webhook-token" | \
  gcloud secrets create budget_webhook_token --data-file=- --project=redstonecipher-web

# Tailscale auth key
echo -n "your-ts-authkey" | \
  gcloud secrets create ts_authkey --data-file=- --project=redstonecipher-web
```

---

## Standard Deployment

### 1. Deploy Backend to Cloud Run
```bash
cd /Users/nicholasweiner/Desktop/mc-manager-web
gcloud builds submit --config cloudbuild.yaml
```

This builds and deploys:
- Rust backend API
- Cloud Run service `redstonecipher-web`
- Scaling: min=0, max=3, concurrency=80
- Region: us-central1

### 2. Build and Deploy Frontend to Firebase
```bash
# Build frontend
cd frontend
npm install
npm run build

# Deploy to Firebase Hosting
cd ..
firebase deploy --only hosting
```

### 3. Deploy Budget Shutdown System

#### Deploy Cloud Function
```bash
cd functions/budget-shutdown
./deploy.sh
```

#### Deploy Cloud Run Job
```bash
cd ../shutdown-job
./deploy-job.sh
```

### 4. Configure DNS (First Time Only)
Point your domain to Firebase Hosting:
- Go to Firebase Console → Hosting
- Add custom domain: `redstonecipher.com`
- Update DNS A records to Firebase IPs (provided in console)

---

## Budget Shutdown System Setup

### Deploy Components (Done Above)
- ✅ Cloud Function: `budget-shutdown`
- ✅ Cloud Run Job: `budget-shutdown-job`
- ✅ Pub/Sub Topic: `redstonecipher-budget-alerts`

### Create $8 Budget (Manual - One Time)
1. Go to: https://console.cloud.google.com/billing/01D611-3D5E81-CECCE6/budgets
2. Click "CREATE BUDGET"
3. Configure:
   - Name: `redstonecipher-shutdown-8usd`
   - Projects: `redstonecipher-web` only
   - Amount: **$8.00 USD** monthly
   - Threshold: **100%** (triggers at $8)
   - Pub/Sub: `projects/redstonecipher-web/topics/redstonecipher-budget-alerts`
   - Disable email notifications
4. Click "FINISH"

---

## Verification Steps

### 1. Test Backend Health
```bash
curl https://redstonecipher-web-868495187875.us-central1.run.app/api/metrics
```

### 2. Test Frontend
```bash
curl https://redstonecipher.com
# Should return HTML with React app
```

### 3. Test Budget Shutdown (Safe - Below Threshold)
```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{"costAmount": 5.0, "budgetAmount": 8.0, "budgetDisplayName": "Test"}'

# Check function logs
gcloud functions logs read budget-shutdown --region=us-central1 --gen2 --limit=10
# Should see "No action taken"
```

### 4. Verify Cloud Run Scaling
```bash
gcloud run services describe redstonecipher-web --region=us-central1 \
  --format="value(spec.template.metadata.annotations)" | grep Scale
# Should show: minScale=0, maxScale=3
```

---

## Rollback Procedures

### Rollback Backend
```bash
# List recent revisions
gcloud run revisions list --service=redstonecipher-web --region=us-central1 --limit=5

# Route traffic to previous revision
gcloud run services update-traffic redstonecipher-web \
  --region=us-central1 \
  --to-revisions=<REVISION-NAME>=100
```

### Rollback Frontend
```bash
# List deployment history
firebase hosting:channel:list

# Rollback to previous version (from Firebase Console)
# Or redeploy from previous git commit
git checkout <previous-commit>
cd frontend && npm run build && cd ..
firebase deploy --only hosting
```

### Disable Budget Shutdown
```bash
# Temporarily disable the Cloud Function
gcloud functions delete budget-shutdown --region=us-central1 --quiet

# Or delete the budget in Google Cloud Console
```

---

## Monitoring

### Cloud Run Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=redstonecipher-web" \
  --limit=50 \
  --format=json
```

### Cloud Function Logs
```bash
gcloud functions logs read budget-shutdown --region=us-central1 --gen2 --limit=20
```

### Budget Status
```bash
gcloud billing budgets list --billing-account=01D611-3D5E81-CECCE6
```

### Firebase Hosting Status
```bash
firebase hosting:channel:list
```

---

## Cost Optimization

### Current Configuration
- **Frontend**: Free (Firebase Hosting free tier)
- **Backend**: $0 when idle (scale-to-zero)
- **Budget Cap**: $8/month automatic shutdown
- **Total**: $0-8/month

### Cost Breakdown
- Cloud Run: Pay only for requests (idle = $0)
- Cloud Function: Free tier covers budget monitoring
- Cloud Run Job: Only runs on budget alerts (~seconds/month)
- Firebase Hosting: 10GB storage + 360MB/day bandwidth free

---

## Restore Service After Budget Shutdown

If the budget shutdown system triggers:

```bash
# Restore normal scaling
gcloud run services update redstonecipher-web \
  --region=us-central1 \
  --min-instances=0 \
  --max-instances=3

# Or redeploy
gcloud builds submit --config cloudbuild.yaml
```

---

## Maintenance

### Update Cloud Run
```bash
# Make code changes, then:
gcloud builds submit --config cloudbuild.yaml
```

### Update Frontend
```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

### Update Budget Shutdown System
```bash
# Update Cloud Function
cd functions/budget-shutdown
./deploy.sh

# Update Cloud Run Job
cd ../shutdown-job
./deploy-job.sh
```

### Update Dependencies
```bash
# Backend
cd backend
cargo update

# Frontend
cd ../frontend
npm update
```

---

## Troubleshooting

### Frontend Not Loading
1. Check Firebase Hosting deployment: `firebase hosting:channel:list`
2. Verify DNS points to Firebase IPs
3. Check browser console for errors
4. Verify rewrites in `firebase.json`

### Backend API Errors
1. Check Cloud Run logs: `gcloud logging read ...`
2. Verify secrets are accessible
3. Check Tailscale connection to Minecraft VM
4. Verify service account permissions

### Budget Shutdown Not Working
1. Verify budget exists in Console
2. Check Pub/Sub topic: `gcloud pubsub topics describe redstonecipher-budget-alerts`
3. Test manually: `gcloud pubsub topics publish ...`
4. Check function logs for errors

### Service Won't Scale to Zero
1. Ensure no traffic to service
2. Check for background tasks keeping instances alive
3. Verify min-instances=0 is set
4. Wait 15 minutes for scale-down

---

## Documentation

- Architecture: `README.md`
- Budget Shutdown: `docs/budget-shutdown-setup.md`
- Budget Cap: `docs/budget-cap.md`
- Functions: `functions/README.md`

---

## Emergency Contacts

- GCP Project: `redstonecipher-web`
- Billing Account: `01D611-3D5E81-CECCE6`
- Region: `us-central1`
- Firebase Project: `redstonecipher-web`

---

## Deployment Checklist

- [ ] Backend deployed to Cloud Run
- [ ] Frontend built and deployed to Firebase
- [ ] DNS points to Firebase Hosting
- [ ] Budget shutdown system deployed
- [ ] $8 budget created in Console
- [ ] Secrets configured in Secret Manager
- [ ] Service health verified
- [ ] Budget alert tested
- [ ] Cost monitoring enabled
- [ ] Backup and restore procedures documented

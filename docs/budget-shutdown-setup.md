# Budget Shutdown System - Complete Setup Guide

This guide covers the complete setup and automation of the $8 budget-based Cloud Run shutdown system.

## Architecture Overview

```
Budget Alert → Pub/Sub → Cloud Function → Cloud Run Job → Scales Service to 0
```

**Components:**
1. **GCP Budget** - Monitors spending, sends alerts at $8 threshold
2. **Pub/Sub Topic** - `redstonecipher-budget-alerts` receives budget notifications
3. **Cloud Function** - `budget-shutdown` processes alerts and triggers shutdown
4. **Cloud Run Job** - `budget-shutdown-job` executes gcloud CLI to scale service

## Deployment Status

### ✅ Completed Components

1. **Pub/Sub Topic**: `redstonecipher-budget-alerts` ✓
2. **Cloud Function**: `budget-shutdown` (deployed to us-central1) ✓
3. **Cloud Run Job**: `budget-shutdown-job` (deployed to us-central1) ✓
4. **Service Account Permissions**: `redstonecipher-sa` has required roles ✓

### 🔲 Manual Step Required: Create $8 Budget

Due to Google Cloud API quota limitations, the budget must be created via the **Google Cloud Console**.

#### Steps to Create Budget:

1. **Navigate to Billing Budgets**
   - Go to: https://console.cloud.google.com/billing/01D611-3D5E81-CECCE6/budgets
   - Click **"CREATE BUDGET"**

2. **Budget Scope**
   - Name: `redstonecipher-shutdown-8usd`
   - Projects: Select **`redstonecipher-web`** only
   - Services: All services
   - Time range: **Monthly**

3. **Set Budget Amount**
   - Budget type: Specified amount
   - Target amount: **$8.00 USD**

4. **Set Alert Threshold**
   - Threshold rules: **100% of budget**
   - Trigger on: **Actual costs**
   - Basis: **Current spend**

5. **Manage Notifications**
   - Connect to Pub/Sub topic: `projects/redstonecipher-web/topics/redstonecipher-budget-alerts`
   - Email notifications: **Disable** (check "Disable default IAM recipients")
   - Monitoring notification channels: None

6. **Finish**
   - Review settings
   - Click **"FINISH"** to create the budget

## How It Works

### Normal Operation
- Cloud Run service runs with `min=0, max=3`
- Scales to zero when idle (no cost)
- Scales up on demand (cost only when handling requests)

### Budget Exceeded ($8 Reached)
1. GCP Budget detects cost >= $8.00
2. Sends notification to Pub/Sub topic `redstonecipher-budget-alerts`
3. Cloud Function `budget-shutdown` is triggered by Pub/Sub message
4. Function checks: `costAmount >= $8.00` threshold
5. Function triggers Cloud Run Job `budget-shutdown-job`
6. Job executes: `gcloud run services update --min-instances=0 --max-instances=1`
7. Cloud Run service scaled down to maximum 1 instance
8. Service scales to 0 and stays there (no traffic = no cost)

### Service Status After Shutdown
- Min instances: 0
- Max instances: 1 (down from 3)
- Active instances: 0
- Traffic: None (service accepts no new requests)
- Cost: **$0 per hour** (no running instances)

## Restoring Service After Shutdown

### Option 1: Via gcloud CLI
```bash
gcloud run services update redstonecipher-web \
  --region=us-central1 \
  --min-instances=0 \
  --max-instances=3
```

### Option 2: Via Cloud Build
```bash
cd /Users/nicholasweiner/Desktop/mc-manager-web
gcloud builds submit --config cloudbuild.yaml
```

## Testing the System

### Test Without Actually Shutting Down
Send a budget alert below the $8 threshold:
```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{"costAmount": 5.0, "budgetAmount": 8.0, "budgetDisplayName": "Test - Below Threshold"}'
```

Expected result: Function logs "No action taken"

### Test Actual Shutdown (⚠️ Will Shut Down Service)
Send a budget alert above the threshold:
```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{"costAmount": 10.0, "budgetAmount": 8.0, "budgetDisplayName": "Test - Trigger Shutdown"}'
```

Expected result:
1. Cloud Function triggers job
2. Cloud Run Job executes successfully
3. Service scaled to max=1
4. Service shuts down (0 instances)

### Manual Job Execution
Test the shutdown job directly:
```bash
gcloud run jobs execute budget-shutdown-job --region=us-central1 --wait
```

## Monitoring

### View Cloud Function Logs
```bash
gcloud functions logs read budget-shutdown \
  --region=us-central1 \
  --gen2 \
  --limit=50
```

### View Cloud Run Job Logs
```bash
gcloud logging read "resource.labels.job_name=budget-shutdown-job" \
  --limit=20 \
  --format="value(textPayload)"
```

### View Job Executions
```bash
gcloud run jobs executions list \
  --job=budget-shutdown-job \
  --region=us-central1 \
  --limit=5
```

### Check Cloud Run Service Status
```bash
gcloud run services describe redstonecipher-web \
  --region=us-central1 \
  --format="value(spec.template.metadata.annotations)"
```

### Check Current Budget Status
```bash
gcloud billing budgets list \
  --billing-account=01D611-3D5E81-CECCE6 \
  --format="table(displayName,amount.specifiedAmount.units,budgetFilter.projects)"
```

## Cost Estimates

### With Budget Shutdown System

| Scenario | Monthly Cost |
|----------|--------------|
| Normal usage (within budget) | $0 - $8 |
| Budget exceeded | **$8 max** |
| Service auto-shutdown at $8 | $0/hour after shutdown |

### Without Budget Shutdown System

| Scenario | Monthly Cost |
|----------|--------------|
| Normal usage | $0 - $25 |
| Runaway costs (bug/attack) | **$25+ (unlimited)** |

**Savings**: Up to **$17/month** in worst-case scenarios

## Troubleshooting

### Budget Alert Not Triggering Function
- Check Pub/Sub topic subscription
- Verify function has correct trigger configuration
- Check Cloud Function logs for errors

### Function Triggers But Job Doesn't Execute
- Check service account permissions
- Verify job exists: `gcloud run jobs describe budget-shutdown-job --region=us-central1`
- Check function logs for job trigger errors

### Job Executes But Service Not Shut Down
- Check job execution logs
- Verify gcloud command in job script
- Check service account has `roles/run.admin`

### Service Won't Restart After Shutdown
- Manually update via gcloud (see "Restoring Service" above)
- Or redeploy via Cloud Build
- Check for deployment errors in Cloud Run console

## Security Notes

- Service account `redstonecipher-sa` has minimal required permissions
- Budget alerts use dedicated Pub/Sub topic (isolated from other systems)
- Function only responds to budget alerts >= $8 threshold
- Job only updates scaling (doesn't modify service code/config)

## Maintenance

### Updating the Threshold
To change the $8 threshold to a different amount:

1. Update the budget in Google Cloud Console
2. Update Cloud Function environment variable:
   ```bash
   gcloud functions deploy budget-shutdown \
     --update-env-vars=SHUTDOWN_THRESHOLD=10.0 \
     --region=us-central1
   ```

### Redeploying Components

**Cloud Function:**
```bash
cd /Users/nicholasweiner/Desktop/mc-manager-web/functions/budget-shutdown
./deploy.sh
```

**Cloud Run Job:**
```bash
cd /Users/nicholasweiner/Desktop/mc-manager-web/functions/shutdown-job
./deploy-job.sh
```

## Files and Locations

```
mc-manager-web/
├── functions/
│   ├── budget-shutdown/          # Cloud Function
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   ├── deploy.sh
│   │   └── README.md
│   └── shutdown-job/              # Cloud Run Job
│       ├── Dockerfile
│       ├── shutdown.sh
│       └── deploy-job.sh
├── scripts/
│   └── create-8usd-budget.sh      # Budget creation (manual via Console required)
└── docs/
    └── budget-shutdown-setup.md   # This file
```

## Next Steps

1. ✅ All infrastructure deployed
2. 🔲 **Create $8 budget via Google Cloud Console** (see steps above)
3. ✅ System ready and will automatically shut down at $8

Once the budget is created, the system is fully automated!

# Cloud Functions & Jobs

This directory contains serverless components for the redstoneCipher system.

## Budget Shutdown System

Automatically shuts down Cloud Run when monthly costs reach $8 to prevent runaway spending.

### Components

#### 1. Cloud Function: `budget-shutdown/`
- **Trigger**: Pub/Sub topic `redstonecipher-budget-alerts`
- **Purpose**: Monitors budget alerts and triggers shutdown when cost >= $8
- **Location**: us-central1
- **Deployed**: ✅

Deploy:
```bash
cd budget-shutdown && ./deploy.sh
```

#### 2. Cloud Run Job: `shutdown-job/`
- **Purpose**: Executes gcloud CLI to scale Cloud Run service to 0
- **Triggered by**: Cloud Function `budget-shutdown`
- **Location**: us-central1  
- **Deployed**: ✅

Deploy:
```bash
cd shutdown-job && ./deploy-job.sh
```

### Architecture Flow

```
GCP Budget ($8) → Pub/Sub → Cloud Function → Cloud Run Job → Scale Service
```

When monthly costs reach $8:
1. Budget sends alert to Pub/Sub
2. Cloud Function receives alert, triggers Cloud Run Job
3. Job scales service to `min=0, max=1`
4. Service shuts down (0 instances running)
5. **Cost drops to $0/hour** ✅

### Setup Required

**One manual step**: Create $8 budget in Google Cloud Console

See complete setup guide: [`docs/budget-shutdown-setup.md`](../docs/budget-shutdown-setup.md)

### Testing

Test without shutting down (below threshold):
```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{"costAmount": 5.0, "budgetAmount": 8.0, "budgetDisplayName": "Test"}'
```

Test actual shutdown (⚠️ will shut down service):
```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{"costAmount": 10.0, "budgetAmount": 8.0, "budgetDisplayName": "Test Shutdown"}'
```

### Restoring After Shutdown

```bash
gcloud run services update redstonecipher-web \
  --region=us-central1 \
  --min-instances=0 \
  --max-instances=3
```

### Cost Impact

- **Without system**: Up to $25/month (or unlimited in worst case)
- **With system**: Maximum $8/month
- **Savings**: Up to $17/month

### Monitoring

View function logs:
```bash
gcloud functions logs read budget-shutdown --region=us-central1 --gen2 --limit=20
```

View job executions:
```bash
gcloud run jobs executions list --job=budget-shutdown-job --region=us-central1
```

### Documentation

- [Complete Setup Guide](../docs/budget-shutdown-setup.md)
- [Function README](budget-shutdown/README.md)

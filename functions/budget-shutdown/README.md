# Cloud Run Budget Shutdown System

This directory contains a Cloud Function that automatically shuts down the Cloud Run service when costs reach $8.

## Architecture

1. **GCP Budget** monitors `redstonecipher-web` project spending
2. **Pub/Sub Topic** (`redstonecipher-budget-alerts`) receives budget alerts  
3. **Cloud Function** (`budget-shutdown`) processes alerts and shuts down Cloud Run when threshold is reached
4. **Cloud Run** (`redstonecipher-web`) is scaled to 0 instances when budget exceeded

## Deployment Status

✅ **Cloud Function deployed**: `budget-shutdown` in `us-central1`
- Triggered by: `projects/redstonecipher-web/topics/redstonecipher-budget-alerts`
- Shutdown threshold: **$8.00**
- Target service: `redstonecipher-web`

## Creating the $8 Budget

Due to API quota issues, create the budget manually through the Google Cloud Console:

### Steps:

1. Go to [Google Cloud Billing Budgets](https://console.cloud.google.com/billing/01D611-3D5E81-CECCE6/budgets)

2. Click **"CREATE BUDGET"**

3. **Budget configuration:**
   - Name: `redstonecipher-shutdown-8usd`
   - Projects: Select `redstonecipher-web` only
   - Time range: Monthly
   - Budget amount: **$8.00 USD**

4. **Set budget alert:**
   - Threshold: 100% of budget
   - Trigger: When current spend reaches threshold

5. **Manage notifications:**
   - Connect to Pub/Sub topic: `projects/redstonecipher-web/topics/redstonecipher-budget-alerts`
   - Disable default IAM recipients: **Checked**

6. **Finish** - Click "FINISH" to create the budget

## How It Works

When the `redstonecipher-web` project costs reach $8:

1. GCP Budget sends alert to Pub/Sub topic
2. Cloud Function `budget-shutdown` is triggered
3. Function calls Cloud Run API to set `min-instances=0` and `max-instances=0`
4. Cloud Run service scales to zero (effectively shut down)
5. **No new requests are handled** until service is manually restarted

## Restarting the Service

To restart Cloud Run after shutdown:

```bash
gcloud run services update redstonecipher-web \
  --region=us-central1 \
  --min-instances=0 \
  --max-instances=3
```

Or redeploy via Cloud Build:
```bash
cd /Users/user/Desktop/mc-manager-web
gcloud builds submit --config cloudbuild.yaml
```

## Monitoring

View Cloud Function logs:
```bash
gcloud functions logs read budget-shutdown \
  --region=us-central1 \
  --limit=50
```

Check current budget status:
```bash
gcloud billing budgets list \
  --billing-account=01D611-3D5E81-CECCE6 \
  --format="table(displayName,amount.specifiedAmount.units,budgetFilter.projects)"
```

## Configuration

The Cloud Function uses these environment variables:
- `SHUTDOWN_THRESHOLD`: $8.00 (threshold to trigger shutdown)
- `GCP_PROJECT`: redstonecipher-web
- `CLOUD_RUN_SERVICE`: redstonecipher-web  
- `CLOUD_RUN_REGION`: us-central1

## Testing

To test the function without waiting for budget alerts, manually publish a test message:

```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --message='{
    "costAmount": 9.0,
    "budgetAmount": 8.0,
    "budgetDisplayName": "Test Alert"
  }'
```

**Warning**: This will immediately shut down your Cloud Run service!

## Cost Savings

With this system:
- Cloud Run scales to 0 when no traffic (already configured)
- Automatic shutdown at $8 prevents runaway costs
- Firebase Hosting serves frontend for free
- Expected monthly costs: **$0-8** (vs potential $25+)

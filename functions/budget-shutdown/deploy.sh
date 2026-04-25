#!/bin/bash
set -e

# Configuration
PROJECT_ID="redstonecipher-web"
FUNCTION_NAME="budget-shutdown"
REGION="us-central1"
PUBSUB_TOPIC="redstonecipher-budget-alerts"
SHUTDOWN_THRESHOLD="8.0"
CLOUD_RUN_SERVICE="redstonecipher-web"
CLOUD_RUN_REGION="us-central1"

echo "Deploying Cloud Function: ${FUNCTION_NAME}"

gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --runtime=python312 \
  --region="${REGION}" \
  --source=. \
  --entry-point=budget_alert_handler \
  --trigger-topic="${PUBSUB_TOPIC}" \
  --set-env-vars="SHUTDOWN_THRESHOLD=${SHUTDOWN_THRESHOLD},GCP_PROJECT=${PROJECT_ID},CLOUD_RUN_SERVICE=${CLOUD_RUN_SERVICE},CLOUD_RUN_REGION=${CLOUD_RUN_REGION}" \
  --service-account="redstonecipher-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --max-instances=1 \
  --memory=256Mi \
  --timeout=60s \
  --no-allow-unauthenticated

echo "Cloud Function deployed successfully!"
echo "Function will shut down ${CLOUD_RUN_SERVICE} when cost reaches \$${SHUTDOWN_THRESHOLD}"

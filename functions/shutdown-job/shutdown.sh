#!/bin/bash
set -e

PROJECT_ID="${GCP_PROJECT:-redstonecipher-web}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-redstonecipher-web}"
REGION="${CLOUD_RUN_REGION:-us-central1}"

echo "=========================================="
echo "Cloud Run Budget Shutdown"
echo "=========================================="
echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE_NAME}"
echo "Region: ${REGION}"
echo "=========================================="

echo "Scaling ${SERVICE_NAME} to 0 instances..."

# Update service scaling and route traffic to latest revision
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --min-instances=0 \
  --max-instances=1 \
  --quiet

# Update traffic to route 100% to latest revision
echo "Routing traffic to latest revision..."
gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --to-latest \
  --quiet

echo "=========================================="
echo "✓ Successfully scaled ${SERVICE_NAME} to 0"
echo "✓ Service is now shut down"
echo "=========================================="

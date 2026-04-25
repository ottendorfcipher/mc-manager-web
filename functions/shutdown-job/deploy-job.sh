#!/bin/bash
set -e

PROJECT_ID="redstonecipher-web"
REGION="us-central1"
JOB_NAME="budget-shutdown-job"
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/app/${JOB_NAME}"

echo "Building and deploying Cloud Run Job: ${JOB_NAME}"

# Build the container image
echo "Building container image..."
gcloud builds submit --tag "${IMAGE_NAME}" .

# Deploy the Cloud Run Job
echo "Deploying Cloud Run Job..."
gcloud run jobs deploy "${JOB_NAME}" \
  --image="${IMAGE_NAME}" \
  --region="${REGION}" \
  --service-account="redstonecipher-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="GCP_PROJECT=${PROJECT_ID},CLOUD_RUN_SERVICE=redstonecipher-web,CLOUD_RUN_REGION=${REGION}" \
  --max-retries=1 \
  --task-timeout=5m

echo "=========================================="
echo "✓ Cloud Run Job deployed successfully"
echo "Job name: ${JOB_NAME}"
echo "To manually trigger: gcloud run jobs execute ${JOB_NAME} --region=${REGION}"
echo "=========================================="

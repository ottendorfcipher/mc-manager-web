#!/usr/bin/env bash
# NOTE: This script creates a single-project budget and is kept for reference
# only.  The live setup uses a combined $25/month budget covering both
# redstonecipher-web AND minecraft-493201, created via the Billing Budgets
# REST API (gcloud doesn't support multi-project budget filters).
# See docs/budget-cap.md for the current budget details and update instructions.
#
# Idempotently creates the GCP billing plumbing that caps redstoneCipher
# at $8/month (legacy single-project approach):
#
#   1. Enables the Billing Budgets + Pub/Sub APIs.
#   2. Creates a Pub/Sub topic for budget notifications.
#   3. Creates a PUSH subscription that hits the backend's webhook.
#   4. Creates an $8 monthly budget; at 100% ($8) the push notification
#      hits POST /internal/budget-alert and engages the kill-switch.
#
# This script targets the redstoneCipher-web project only.
# Use infra/setup.sh for a full first-time infrastructure bootstrap.
#
# Requirements:
#   - gcloud configured for the project (`gcloud config set project <id>`).
#   - A BILLING_ACCOUNT env var (run `gcloud billing accounts list`).
#   - PROJECT_ID env var (defaults to the active gcloud project).
#   - WEBHOOK_URL env var: https://<cloud-run-or-firebase-url>/internal/budget-alert
#   - BUDGET_WEBHOOK_TOKEN env var: the shared secret also set on the backend.
#
# Usage:
#   BILLING_ACCOUNT=012345-ABCDEF-GHIJKL \
#   PROJECT_ID=redstonecipher-web \
#   WEBHOOK_URL=https://redstonecipher-web.web.app/internal/budget-alert \
#   BUDGET_WEBHOOK_TOKEN=$(openssl rand -hex 32) \
#   scripts/setup-budget.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?BILLING_ACCOUNT is required}"
WEBHOOK_URL="${WEBHOOK_URL:?WEBHOOK_URL is required}"
BUDGET_WEBHOOK_TOKEN="${BUDGET_WEBHOOK_TOKEN:?BUDGET_WEBHOOK_TOKEN is required}"

TOPIC="redstonecipher-budget-alerts"
SUB="redstonecipher-budget-push"
BUDGET_NAME="redstonecipher-8usd-monthly"
BUDGET_AMOUNT_USD=8

say() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }

say "Enabling required APIs"
gcloud services enable \
  billingbudgets.googleapis.com \
  pubsub.googleapis.com \
  --project="$PROJECT_ID"

say "Ensuring Pub/Sub topic '$TOPIC' exists"
gcloud pubsub topics describe "$TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"

say "Ensuring push subscription '$SUB' exists"
PUSH_ENDPOINT="${WEBHOOK_URL}?token=${BUDGET_WEBHOOK_TOKEN}"
if gcloud pubsub subscriptions describe "$SUB" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$SUB" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --project="$PROJECT_ID"
else
  gcloud pubsub subscriptions create "$SUB" \
    --topic="$TOPIC" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --project="$PROJECT_ID"
fi

say "Creating \$$BUDGET_AMOUNT_USD budget (replace if it already exists)"
# gcloud has no `describe-by-display-name`; list and filter.
EXISTING_BUDGET="$(gcloud billing budgets list \
  --billing-account="$BILLING_ACCOUNT" \
  --filter="displayName=$BUDGET_NAME" \
  --format='value(name)' | head -n1 || true)"

if [[ -n "$EXISTING_BUDGET" ]]; then
  echo "Budget already exists: $EXISTING_BUDGET — updating"
  gcloud billing budgets update "$EXISTING_BUDGET" \
    --billing-account="$BILLING_ACCOUNT" \
    --budget-amount="${BUDGET_AMOUNT_USD}USD" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC}"
else
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="$BUDGET_NAME" \
    --budget-amount="${BUDGET_AMOUNT_USD}USD" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC}" \
    --filter-projects="projects/${PROJECT_ID}"
fi

say "Done"
cat <<EOF

Summary:
  Project:       $PROJECT_ID
  Billing acct:  $BILLING_ACCOUNT
  Topic:         projects/$PROJECT_ID/topics/$TOPIC
  Subscription:  projects/$PROJECT_ID/subscriptions/$SUB
  Webhook:       $PUSH_ENDPOINT

Next steps:
  1. Add BUDGET_WEBHOOK_TOKEN to backend/.env (same value as above).
  2. Deploy the backend somewhere the push endpoint can reach (Cloud Run, etc.).
  3. Smoke-test with:
       gcloud pubsub topics publish $TOPIC --project=$PROJECT_ID \\
         --message "$(echo -n '{"costAmount":9,"budgetAmount":8,"alertThresholdExceeded":1.0}' | base64)"
EOF

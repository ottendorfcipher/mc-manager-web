#!/bin/bash
set -e

BILLING_ACCOUNT="01D611-3D5E81-CECCE6"
PROJECT_ID="redstonecipher-web"
PROJECT_NUMBER="868495187875"
BUDGET_AMOUNT="8"
PUBSUB_TOPIC="projects/redstonecipher-web/topics/redstonecipher-budget-alerts"

echo "=========================================="
echo "Creating $8 Budget for Cloud Run Shutdown"
echo "=========================================="
echo "Billing Account: ${BILLING_ACCOUNT}"
echo "Project: ${PROJECT_ID} (${PROJECT_NUMBER})"
echo "Budget Amount: \$${BUDGET_AMOUNT} USD"
echo "Pub/Sub Topic: ${PUBSUB_TOPIC}"
echo "=========================================="

# Create budget JSON payload
cat > /tmp/budget-8usd.json << EOF
{
  "displayName": "redstonecipher-shutdown-8usd",
  "budgetFilter": {
    "projects": ["projects/${PROJECT_NUMBER}"],
    "calendarPeriod": "MONTH",
    "creditTypesTreatment": "INCLUDE_ALL_CREDITS"
  },
  "amount": {
    "specifiedAmount": {
      "currencyCode": "USD",
      "units": "${BUDGET_AMOUNT}"
    }
  },
  "thresholdRules": [
    {
      "thresholdPercent": 1.0,
      "spendBasis": "CURRENT_SPEND"
    }
  ],
  "notificationsRule": {
    "pubsubTopic": "${PUBSUB_TOPIC}",
    "schemaVersion": "1.0",
    "disableDefaultIamRecipients": true
  }
}
EOF

echo "Budget payload created at /tmp/budget-8usd.json"
echo ""
echo "Creating budget..."

# Get access token
ACCESS_TOKEN=$(gcloud auth print-access-token)

# Create budget via REST API  
HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/budget-response.json -X POST \
  "https://billingbudgets.googleapis.com/v1/billingAccounts/${BILLING_ACCOUNT}/budgets?quotaProject=${PROJECT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/budget-8usd.json)

HTTP_BODY=$(cat /tmp/budget-response.json)

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
    echo "=========================================="
    echo "✓ Budget created successfully!"
    echo "=========================================="
    echo "$HTTP_BODY" | jq '.'
    echo ""
    echo "Budget will trigger shutdown when cost reaches \$${BUDGET_AMOUNT}"
    rm -f /tmp/budget-8usd.json
    exit 0
else
    echo "=========================================="
    echo "✗ Failed to create budget"
    echo "=========================================="
    echo "HTTP Status: ${HTTP_CODE}"
    echo "$HTTP_BODY" | jq '.' || echo "$HTTP_BODY"
    rm -f /tmp/budget-8usd.json
    exit 1
fi

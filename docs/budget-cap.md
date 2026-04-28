# $25/month combined budget cap

redstoneCipher has a **$25/month** Cloud Billing budget covering **both** GCP
projects (`redstonecipher-web` + `example-project`) on the same billing
account. When the `alertThresholdExceeded >= 1.0` (100% of budget) message
arrives, the backend engages its **kill-switch**, which:

1. Blocks every mutating `/api/*` endpoint (returns HTTP 503).
2. Surfaces an orange "Tool disabled" banner to every signed-in user.
3. A `global_admin` can re-enable from the banner once investigated.

GCP budgets are **not** hard caps — this is the canonical "best-effort
automated cut-off" pattern.

## Architecture

```
Billing Budget ($25, both projects)
        │
        ▼
  Pub/Sub Topic (redstonecipher-budget-alerts, project: redstonecipher-web)
        │
        ├──► Push subscription (redstonecipher-budget-push)
        │         └──► POST /internal/budget-alert?token=…  (in-app webhook)
        │                   └──► kill_switch::engage()
        │                             └──► kill_switch_guard blocks mutations
        │
        └──► Eventarc → Cloud Function (budget-kill-switch)
                  └──► scales Cloud Run to min=0/max=0 (hard backstop)
```

## Current budget

Budget name: `redstonecipher-combined-budget`  
Billing account: `01D611-3D5E81-CECCE6`  
Projects covered: `projects/591013790694` (example-project) + `projects/868495187875` (redstonecipher-web)  
Thresholds: 50%, 80%, 100% (100% triggers kill-switch)

To update the budget, use the Billing Budgets REST API directly (the `gcloud`
CLI doesn't support multi-project filters):

```bash
curl -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: redstonecipher-web" \
  -H "Content-Type: application/json" \
  "https://billingbudgets.googleapis.com/v1/billingAccounts/01D611-3D5E81-CECCE6/budgets/<BUDGET_ID>" \
  -d '{"amount":{"specifiedAmount":{"currencyCode":"USD","units":"30"}}}'
```

## Manual smoke test

Publish a fake 100%-exceeded alert straight to the topic:

```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --project=redstonecipher-web \
  --message '{"costAmount":26,"budgetAmount":25,"alertThresholdExceeded":1.0}'
```

Confirm the kill-switch engaged:

```bash
curl -s https://example.com/api/kill-switch
# → {"disabled_at":"...","reason":"Budget exceeded: $26.00 of $25.00","source":"budget-webhook"}
```

Release it (requires `killswitch.toggle` permission; sign in first):

```bash
curl -s -X DELETE https://example.com/api/kill-switch \
  -H "Cookie: rc_session=<your-jwt>"
```

## Caveats

- **Alerts fire once per threshold per period.** If an operator re-enables
  after a 100% alert, the budget will not re-fire until the next monthly cycle.
- **Push subscription needs HTTPS.** Pub/Sub refuses plain-HTTP endpoints.
- **Nuclear option:** unlink billing to immediately halt all charges:

  ```bash
  gcloud beta billing projects unlink redstonecipher-web
  gcloud beta billing projects unlink example-project
  ```

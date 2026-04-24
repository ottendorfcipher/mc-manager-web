# $5/month budget cap

redstoneCipher's Firebase/GCP project is capped at **$5 per month** via a
Cloud Billing Budget that emits Pub/Sub notifications. When the
`alertThresholdExceeded >= 1.0` (100% of budget) message arrives, the backend
engages its **kill-switch**, which:

1. Blocks every mutating `/api/*` endpoint (returns HTTP 503).
2. Surfaces an orange "Tool disabled" banner to every signed-in user.
3. Optionally, a `global_admin` can re-enable the tool from the banner once
   the operator has investigated.

Budgets in GCP are **not** hard caps — no Google service enforces a true dollar
ceiling. This design is the canonical "best-effort automated cut-off"
pattern documented by Google.

## Architecture

```
Billing Budget  →  Pub/Sub Topic  →  Push Subscription  →  POST /internal/budget-alert
                                                              │
                                                              ▼
                                              kill_switch::engage(reason, source)
                                                              │
                                                              ▼
                                 middleware::kill_switch_guard rejects mutations
```

## One-time setup

Prerequisites:

- `gcloud` authenticated and pointed at the Firebase/GCP project
  (`gcloud config set project minecraft-493201`).
- Your billing account ID (`gcloud billing accounts list`).
- The backend is reachable over HTTPS at a public URL (Cloud Run, Fly, etc.).
  Pub/Sub push targets cannot reach `http://localhost`; for pure-local
  testing see [Manual smoke test](#manual-smoke-test) below.

Run the setup script:

```bash
BILLING_ACCOUNT=012345-ABCDEF-GHIJKL \
WEBHOOK_URL=https://redstonecipher.com/internal/budget-alert \
BUDGET_WEBHOOK_TOKEN=$(openssl rand -hex 32) \
scripts/setup-budget.sh
```

Copy the generated `BUDGET_WEBHOOK_TOKEN` value into your backend's `.env`
so the webhook handler validates the shared secret.

## Manual smoke test

Without deploying the backend to the public internet, you can still confirm
the wiring end-to-end by publishing a fake alert straight to the topic:

```bash
gcloud pubsub topics publish redstonecipher-budget-alerts \
  --project=minecraft-493201 \
  --message '{"costAmount":6,"budgetAmount":5,"alertThresholdExceeded":1.0}'
```

Pub/Sub will then POST to your webhook; confirm the kill-switch is engaged:

```bash
curl -ks https://redstonecipher.com/api/kill-switch
```

The banner in the SPA appears within 30 s (polling interval).

## Caveats

- **Alerts fire once per threshold per period.** If an operator re-enables
  the kill-switch after a 100% alert, the budget will not re-fire until the
  next monthly cycle. Manual re-enables should therefore be rare.
- **Push subscription needs HTTPS.** Pub/Sub refuses plain-HTTP push
  endpoints and requires the target respond 2xx within a few seconds; the
  handler already returns 204 quickly.
- **Nuclear option:** if charges continue to accrue after the kill-switch
  engages, manually unlink billing from the project:

  ```bash
  gcloud beta billing projects unlink minecraft-493201
  ```

  This stops all GCP activity on the project but is hard to reverse.

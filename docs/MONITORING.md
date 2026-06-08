# Monitoring & Log Aggregation

The backend already exposes everything a standard observability stack needs:

- **Metrics** — Prometheus text at `GET /metrics` (uptime, DB-pool, SSE
  subscriber counts, active events, per-runner heartbeat ages). Localhost /
  Tailscale only; not proxied by nginx.
- **Health** — `GET /health` (liveness), `GET /ready` (DB ping + pool + runner
  heartbeats).
- **Structured logs** — the `tracing` subscriber writes to the systemd journal
  (`journalctl -u redstonecipher`).

This doc covers turning those into dashboards + alerts. Pick the tier that fits.

---

## Tier 0 — no extra infrastructure (built-in)

Cron-able scripts that need nothing but the host:

- **Error alerting:** `scripts/log-alert.sh` scans the backend journal every few
  minutes and emails (via Resend) when ERROR lines spike.
  ```cron
  */5 * * * * RESEND_API_KEY=re_… ALERT_EMAIL=you@example.com \
              /opt/redstonecipher/scripts/log-alert.sh >> /var/log/redstonecipher-alert.log 2>&1
  ```
- **TLS expiry:** `scripts/check-tls-expiry.sh` (daily) — warns before certbot lapses.
- **Backup integrity + offsite:** `scripts/backup-db.sh` already fails loudly and
  retries the offsite copy.

---

## Tier 1 — Prometheus + Grafana + Alertmanager

1. Install Prometheus on the web host (or a monitoring box that can reach it
   over Tailscale).
2. Add the scrape job: `infra/observability/prometheus-scrape.yml`.
3. Load the alert rules: `infra/observability/alert-rules.yml`
   (`rule_files:` in `prometheus.yml`). They alert on:
   - `BackendDown` — `/metrics` unscrapeable for 2m.
   - `RunnerStalled` — an always-on runner's heartbeat age > 5m.
   - `DbPoolSaturated` — no idle SQLite connections for 3m.
4. Point Alertmanager at email/Slack/PagerDuty.
5. Grafana: add Prometheus as a datasource and graph the
   `redstonecipher_*` gauges (uptime, pool, subscribers, heartbeats).

---

## Tier 2 — centralised logs (Loki)

1. Run Loki (local container or remote).
2. Install promtail on the web host with
   `infra/observability/promtail.yaml` (ships the `redstonecipher` and `nginx`
   journald units; set `LOKI_URL`).
3. In Grafana, add Loki as a datasource and query
   `{job="redstonecipher", level="error"}` etc. Wire Grafana alerting on log
   patterns if you prefer it over Alertmanager.

---

## What to watch

| Signal | Source | Why |
|--------|--------|-----|
| Backend up | `up`, `/health` | Process / serving |
| Readiness | `/ready` (503) | DB reachable |
| Runner heartbeats | `redstonecipher_runner_heartbeat_age_seconds` | A background task died |
| DB pool idle | `redstonecipher_db_pool_idle` | Connection leak / saturation |
| 5xx + ERROR logs | journal / Loki | App errors |
| TLS expiry | `check-tls-expiry.sh` | Cert lapse |
| Disk free | node_exporter | Backups/journal filling disk |

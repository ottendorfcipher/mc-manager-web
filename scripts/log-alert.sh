#!/usr/bin/env bash
# scripts/log-alert.sh
#
# Lightweight, dependency-free error alerting for hosts without a full
# Prometheus/Alertmanager stack. Scans the redstoneCipher backend journal since
# the last run; if the count of ERROR-level lines in the window exceeds
# THRESHOLD, sends an email via Resend (if configured) and exits non-zero so a
# cron failure is also visible.
#
# Cron (every 5 min) on the web server:
#   */5 * * * * /opt/redstonecipher/scripts/log-alert.sh >> /var/log/redstonecipher-alert.log 2>&1
#
# Environment overrides (safe defaults):
#   UNIT             redstonecipher.service
#   WINDOW           5min            (journalctl --since value)
#   THRESHOLD        5               (errors in WINDOW before alerting)
#   RESEND_API_KEY   (unset → no email, just logs + exit code)
#   ALERT_EMAIL      (recipient; required for email)
#   ALERT_FROM       redstoneCipher <onboarding@redstonecipher.com>

set -euo pipefail

UNIT="${UNIT:-redstonecipher.service}"
WINDOW="${WINDOW:-5min}"
THRESHOLD="${THRESHOLD:-5}"
ALERT_FROM="${ALERT_FROM:-redstoneCipher <onboarding@redstonecipher.com>}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [log-alert] $*"; }

command -v journalctl >/dev/null 2>&1 || { log "journalctl not found — skipping"; exit 0; }

# Count ERROR-priority lines (and obvious 5xx) in the window.
ERRORS="$(journalctl -u "${UNIT}" --since "-${WINDOW}" --no-pager 2>/dev/null \
  | grep -icE 'ERROR|panicked| 5[0-9]{2} ' || true)"
ERRORS="${ERRORS:-0}"

log "${UNIT}: ${ERRORS} error line(s) in the last ${WINDOW} (threshold ${THRESHOLD})"

if [[ "${ERRORS}" -lt "${THRESHOLD}" ]]; then
    exit 0
fi

SAMPLE="$(journalctl -u "${UNIT}" --since "-${WINDOW}" --no-pager 2>/dev/null \
  | grep -iE 'ERROR|panicked| 5[0-9]{2} ' | tail -10 | sed 's/"/\\"/g')"

MSG="redstoneCipher: ${ERRORS} errors in ${UNIT} over the last ${WINDOW} (threshold ${THRESHOLD})."
log "ALERT: ${MSG}"

# Best-effort email via Resend.
if [[ -n "${RESEND_API_KEY:-}" && -n "${ALERT_EMAIL:-}" ]]; then
    body="$(printf '{"from":"%s","to":["%s"],"subject":"redstoneCipher error spike","text":"%s\\n\\nRecent lines:\\n%s"}' \
        "${ALERT_FROM}" "${ALERT_EMAIL}" "${MSG}" "${SAMPLE}")"
    if curl -fsS -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer ${RESEND_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "${body}" >/dev/null 2>&1; then
        log "alert email sent to ${ALERT_EMAIL}"
    else
        log "WARNING: alert email failed to send"
    fi
else
    log "RESEND_API_KEY/ALERT_EMAIL not set — alert logged only"
fi

# Non-zero so the cron run is itself flagged as failed.
exit 1

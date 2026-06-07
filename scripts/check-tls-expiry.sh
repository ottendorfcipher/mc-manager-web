#!/usr/bin/env bash
# scripts/check-tls-expiry.sh
#
# Warn (non-zero exit) when the TLS certificate is within THRESHOLD_DAYS of
# expiry, so a failed certbot renewal doesn't silently lapse. Certbot renews
# automatically twice daily; this is the safety net that tells you when that
# automation has stopped working.
#
# Cron it daily on the web server, e.g.:
#   17 6 * * * /opt/redstonecipher/scripts/check-tls-expiry.sh \
#                >> /var/log/redstonecipher-tls.log 2>&1
#
# Environment overrides (safe defaults):
#   DOMAIN           example.com
#   CERT_PATH        /etc/letsencrypt/live/$DOMAIN/cert.pem
#   THRESHOLD_DAYS   21
#   ALERT_CMD        (optional) shell command run with the message on its $1

set -euo pipefail

DOMAIN="${DOMAIN:-example.com}"
CERT_PATH="${CERT_PATH:-/etc/letsencrypt/live/${DOMAIN}/cert.pem}"
THRESHOLD_DAYS="${THRESHOLD_DAYS:-21}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [tls-check] $*"; }

# Read the expiry: prefer the on-disk cert; fall back to a live TLS probe.
if [[ -r "${CERT_PATH}" ]]; then
    end_date="$(openssl x509 -enddate -noout -in "${CERT_PATH}" | cut -d= -f2)"
else
    log "cert file ${CERT_PATH} not readable — probing ${DOMAIN}:443 instead"
    end_date="$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null \
                  | openssl x509 -enddate -noout | cut -d= -f2)"
fi

[[ -n "${end_date}" ]] || { log "ERROR: could not determine certificate expiry"; exit 2; }

# Convert to epoch (GNU date; BSD/macOS fallback).
if end_epoch="$(date -d "${end_date}" +%s 2>/dev/null)"; then :; else
    end_epoch="$(date -j -f "%b %e %T %Y %Z" "${end_date}" +%s)"
fi
now_epoch="$(date +%s)"
days_left=$(( (end_epoch - now_epoch) / 86400 ))

log "${DOMAIN} certificate expires in ${days_left} day(s) (on ${end_date})"

if (( days_left < 0 )); then
    log "CRITICAL: certificate has EXPIRED"
    exit 1
elif (( days_left <= THRESHOLD_DAYS )); then
    msg="redstoneCipher TLS for ${DOMAIN} expires in ${days_left} day(s) — certbot renewal may have stalled"
    log "WARNING: ${msg}"
    [[ -n "${ALERT_CMD:-}" ]] && ${ALERT_CMD} "${msg}" || true
    exit 1
fi

log "OK — more than ${THRESHOLD_DAYS} days remaining"

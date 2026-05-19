#!/usr/bin/env bash
# set-api-keys.sh — securely configure optional API keys on the live server
#
# Security properties:
#   • Keys read with `read -s` — no terminal echo
#   • Values never written to a local file or shell history
#   • Passed to the server via SSH environment variables (not command-line args)
#   • Upserted via Python on the remote — handles special chars safely
#   • .env is backed up before every change
#
# Usage: bash scripts/set-api-keys.sh

set -euo pipefail

WEB_SERVER="root@178.105.43.199"
ENV_FILE="/opt/redstonecipher/.env"

echo ""
echo "redstoneCipher — API key setup"
echo "Press Enter to skip any key you don't want to set."
echo ""

# ── Silent prompt helper ─────────────────────────────────────────────────────
prompt_secret() {
  local label="$1"
  local val
  IFS= read -r -s -p "  $label: " val
  echo "" >&2   # newline after hidden input
  printf '%s' "$val"
}

echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  redstoneCipher — API key setup                         │"
echo "│  Press Enter to skip any key you don't want to set now. │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""

echo "── Email — Resend ───────────────────────────────────────────"
echo "   https://resend.com → API Keys → Create API key"
echo "   Free tier: 3,000 emails/month"
RESEND_KEY=$(prompt_secret "RESEND_API_KEY (re_...)")

echo ""
echo "── Tailscale — user invite API ──────────────────────────────"
echo "   https://login.tailscale.com/admin/settings/keys"
echo "   Scopes needed: write:invites"
TS_KEY=$(prompt_secret "TAILSCALE_API_KEY (tskey-api-...)")
TS_NET=$(prompt_secret "TAILSCALE_TAILNET  (email or tailnet slug)")

echo ""
echo "── Site URL (appears in email invite links) ─────────────────"
SITE_URL=$(prompt_secret "SITE_URL [https://redstonecipher.com]")
SITE_URL="${SITE_URL:-https://redstonecipher.com}"

# ── Confirm ───────────────────────────────────────────────────────────────────
echo ""
echo "── Will write to ${WEB_SERVER}:${ENV_FILE} ───"
if [[ -n "$RESEND_KEY" ]];  then echo "  RESEND_API_KEY     ${RESEND_KEY:0:8}…  (${#RESEND_KEY} chars)"
                             else echo "  RESEND_API_KEY     (skip)"; fi
if [[ -n "$TS_KEY" ]];      then echo "  TAILSCALE_API_KEY  ${TS_KEY:0:12}…  (${#TS_KEY} chars)"
                             else echo "  TAILSCALE_API_KEY  (skip)"; fi
if [[ -n "$TS_NET" ]];      then echo "  TAILSCALE_TAILNET  $TS_NET"
                             else echo "  TAILSCALE_TAILNET  (skip)"; fi
echo   "  SITE_URL           $SITE_URL"
echo ""
read -r -p "Apply and restart the service? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }

# ── Write via SSH env-vars (keys never touch a local file) ────────────────────
echo ""
echo "Writing to server..."

ssh "$WEB_SERVER" env \
    RESEND_API_KEY="$RESEND_KEY" \
    TAILSCALE_API_KEY="$TS_KEY" \
    TAILSCALE_TAILNET="$TS_NET" \
    SITE_URL="$SITE_URL" \
    ENV_FILE="$ENV_FILE" \
    bash << 'REMOTE'
set -euo pipefail

BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
echo "  Backup: $BACKUP"

# Upsert key=value: Python handles any special characters in the value safely.
upsert() {
  local key="$1" val="$2"
  [[ -z "$val" ]] && return 0

  python3 - "$key" "$val" "$ENV_FILE" << 'PYEOF'
import sys, re
key, val, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    content = f.read()
pattern = re.compile(r'^' + re.escape(key) + r'=.*', re.MULTILINE)
if pattern.search(content):
    content = pattern.sub(key + '=' + val, content)
    action = 'Updated'
else:
    content = content.rstrip('\n') + '\n' + key + '=' + val + '\n'
    action = 'Added  '
with open(path, 'w') as f:
    f.write(content)
print(f'  {action}: {key}')
PYEOF
}

upsert "RESEND_API_KEY"    "${RESEND_API_KEY}"
upsert "TAILSCALE_API_KEY" "${TAILSCALE_API_KEY}"
upsert "TAILSCALE_TAILNET" "${TAILSCALE_TAILNET}"
upsert "SITE_URL"          "${SITE_URL}"

echo ""
echo "  Restarting redstonecipher..."
systemctl restart redstonecipher
sleep 5
if systemctl is-active --quiet redstonecipher; then
    echo "  ✓ Service running"
else
    echo "  ✗ Service failed — check: journalctl -u redstonecipher -n 20"
    exit 1
fi
REMOTE

echo ""
echo "✓ Done. Keys are live on the server."
echo "  To test: Admin → Users → Invite Member"

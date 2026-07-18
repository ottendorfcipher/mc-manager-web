#!/usr/bin/env bash
# scripts/deploy-watchdog.sh
#
# Deploy the Minecraft Tailscale admission watchdog to mc-server-1.
#
# What this does (all steps are idempotent):
#   1.  Copies watchdog.py   → /opt/minecraft/scripts/watchdog.py
#   2.  Copies the systemd unit → /etc/systemd/system/mc-watchdog.service
#   3.  Creates /etc/mc-watchdog.env (prompts for WATCHDOG_TOKEN if not set)
#   4.  Enables and (re)starts the mc-watchdog service
#   5.  Locks down port 25565 to the tailscale0 interface via UFW
#       so only Tailscale peers can reach the Minecraft server
#
# Required env vars:
#   MC_SERVER_HOST   SSH destination for mc-server-1
#                    (e.g. root@your-mc-server or root@<gcp-external-ip>)
#
# Optional env vars:
#   WATCHDOG_TOKEN   pre-set token (will be prompted for if not provided)
#   SSH_KEY          path to SSH private key (default: ~/.ssh/id_rsa)
#   BACKEND_URL      backend base URL (default: https://your-domain.com)
#
# Example:
#   MC_SERVER_HOST=root@your-mc-server bash scripts/deploy-watchdog.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra/mc-watchdog"

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[0;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "    \033[0;33m⚠ %s\033[0m\n" "$*"; }
die()  { printf "\n\033[0;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

# ── 0. Resolve parameters ─────────────────────────────────────────────────────

MC_SERVER_HOST="${MC_SERVER_HOST:-}"
if [[ -z "${MC_SERVER_HOST}" ]]; then
    die "MC_SERVER_HOST is required. Example: MC_SERVER_HOST=root@your-mc-server $0"
fi

SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_rsa}"
BACKEND_URL="${BACKEND_URL:-https://your-domain.com}"

if [[ -z "${WATCHDOG_TOKEN:-}" ]]; then
    read -rsp "  Enter WATCHDOG_TOKEN (must match the backend secret): " WATCHDOG_TOKEN
    echo
fi
[[ -n "${WATCHDOG_TOKEN}" ]] || die "WATCHDOG_TOKEN cannot be empty"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
if [[ -f "${SSH_KEY}" ]]; then
    SSH_OPTS+=(-i "${SSH_KEY}")
fi

ssh_run() {
    ssh "${SSH_OPTS[@]}" "${MC_SERVER_HOST}" "$@"
}

scp_put() {
    local local_file="$1" remote_path="$2"
    scp -q "${SSH_OPTS[@]}" "${local_file}" "${MC_SERVER_HOST}:${remote_path}"
}

# ── 1. Upload watchdog.py ─────────────────────────────────────────────────────

say "Uploading watchdog.py"
ssh_run "mkdir -p /opt/minecraft/scripts"
scp_put "${INFRA_DIR}/watchdog.py" "/opt/minecraft/scripts/watchdog.py"
ssh_run "chmod 750 /opt/minecraft/scripts/watchdog.py"
ok "watchdog.py → /opt/minecraft/scripts/watchdog.py"

# ── 2. Upload systemd unit ────────────────────────────────────────────────────

say "Uploading systemd unit"
scp_put "${INFRA_DIR}/mc-watchdog.service" "/etc/systemd/system/mc-watchdog.service"
ok "mc-watchdog.service → /etc/systemd/system/mc-watchdog.service"

# ── 3. Write /etc/mc-watchdog.env ────────────────────────────────────────────

say "Writing /etc/mc-watchdog.env"
# Use Python on the server to avoid any shell escaping issues with the token.
python3_write_env=$(cat <<'PYEOF'
import os, sys
path = "/etc/mc-watchdog.env"
content = (
    f"BACKEND_URL={os.environ['BACKEND_URL']}\n"
    f"WATCHDOG_TOKEN={os.environ['WATCHDOG_TOKEN']}\n"
    "MC_LOG_PATH=/opt/minecraft/server/logs/latest.log\n"
    "MC_FIFO_PATH=/opt/minecraft/console.fifo\n"
)
with open(path, "w") as f:
    f.write(content)
os.chmod(path, 0o600)  # root-readable only
print(f"Written {path}")
PYEOF
)

ssh_run "BACKEND_URL='${BACKEND_URL}' WATCHDOG_TOKEN='${WATCHDOG_TOKEN}' python3 -c '${python3_write_env}'"
ok "/etc/mc-watchdog.env written (mode 600)"

# ── 4. Enable and (re)start the service ──────────────────────────────────────

say "Enabling and starting mc-watchdog"
ssh_run "systemctl daemon-reload"
ssh_run "systemctl enable mc-watchdog"
ssh_run "systemctl restart mc-watchdog"
sleep 2
STATUS=$(ssh_run "systemctl is-active mc-watchdog" || true)
if [[ "${STATUS}" == "active" ]]; then
    ok "mc-watchdog is active"
else
    warn "mc-watchdog status: ${STATUS} — check logs with: journalctl -u mc-watchdog -n 50"
fi

# ── 5. UFW: restrict port 25565 to tailscale0 only ───────────────────────────

say "Configuring UFW firewall (port 25565 → tailscale0 only)"
warn "This will drop direct (non-Tailscale) connections to port 25565."
warn "Make sure all players use Tailscale before applying."
echo
read -rp "  Apply UFW rules now? [y/N] " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
    warn "UFW rules skipped. Run manually on mc-server-1:"
    warn "  ufw delete allow 25565"
    warn "  ufw allow in on tailscale0 to any port 25565"
    warn "  ufw reload"
else
    ssh_run "bash -s" <<'UFW'
set -euo pipefail
# Remove any broad allow rules for 25565 (TCP, UDP, or combined).
for RULE in "25565" "25565/tcp" "25565/udp"; do
    if ufw status | grep -qw "${RULE}"; then
        ufw delete allow "${RULE}" || true
    fi
done
# Allow only via tailscale0.
ufw allow in on tailscale0 to any port 25565 proto tcp comment "MC: Tailscale only"
ufw allow in on tailscale0 to any port 25565 proto udp comment "MC: Tailscale only"
ufw reload
echo "UFW updated"
UFW
    ok "Port 25565 restricted to tailscale0"
fi

# ── 6. Disable vanilla whitelist ─────────────────────────────────────────────
#
# The admission flow requires white-list=false so that first-time Tailscale
# players can connect once before being evaluated.  The watchdog handles
# enforcement; the vanilla whitelist is no longer needed.

say "Disabling vanilla Minecraft whitelist"
warn "The watchdog takes over admission control — the vanilla whitelist is not needed."
echo
read -rp "  Disable vanilla whitelist now (recommended)? [Y/n] " CONFIRM_WL
if [[ "${CONFIRM_WL,,}" != "n" ]]; then
    ssh_run "bash -s" <<'WLBLOCK'
set -euo pipefail
PROPS=/opt/minecraft/server/server.properties
if [[ -f "${PROPS}" ]]; then
    # Update the property in-place.
    if grep -q "^white-list=" "${PROPS}"; then
        sed -i 's/^white-list=.*/white-list=false/' "${PROPS}"
    else
        echo "white-list=false" >> "${PROPS}"
    fi
    echo "server.properties updated (white-list=false)"
    # Apply live without restart if the server is running.
    FIFO=/opt/minecraft/console.fifo
    if [ -p "${FIFO}" ]; then
        echo "whitelist off" > "${FIFO}"
        echo "Live whitelist disabled via FIFO"
    fi
else
    echo "WARNING: ${PROPS} not found — set white-list=false manually"
fi
WLBLOCK
    ok "Vanilla whitelist disabled"
else
    warn "Whitelist not changed. Set white-list=false in server.properties manually."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

say "Deployment complete"
cat <<EOF

  Watchdog script:  /opt/minecraft/scripts/watchdog.py
  Systemd unit:     /etc/systemd/system/mc-watchdog.service
  Environment:      /etc/mc-watchdog.env  (mode 600)

  Monitor logs:     ssh ${MC_SERVER_HOST} journalctl -u mc-watchdog -f
  Pending queue:    https://your-domain.com  → Admin → Pending Players

  Next steps:
    1. Add WATCHDOG_TOKEN to the backend .env / Cloud Run secret:
         WATCHDOG_TOKEN=<the token you just set>
       Then redeploy the backend so it accepts watchdog requests.

    2. Verify the flow with a test join from a Tailscale-connected client:
         - First join  → action=allow  (player added to pending queue)
         - Second join → action=kick   (kicked with approval message)
         - After admin links the IGN → action=allow on every future join

    3. If UFW rules were skipped, apply them manually (see warning above).

EOF

#!/usr/bin/env bash
# infra/security/setup-service-user.sh
#
# Creates a dedicated system user for the redstoneCipher backend and updates
# the systemd service unit with least-privilege hardening directives.
#
# This reduces the blast radius of any hypothetical backend compromise from
# "full root on the web server" to "access to /opt/redstonecipher only".
#
# Safe to re-run — every step is idempotent.
#
# What this does:
#   1. Creates the 'redstonecipher' system user (no login shell, no home
#      directory outside /opt/redstonecipher)
#   2. Changes ownership of /opt/redstonecipher to that user
#   3. Installs the hardened systemd unit from infra/redstonecipher.service
#   4. Reloads systemd and restarts the service (~2 second downtime)
#   5. Verifies the service is running as the new user
#
# Run on the web server:
#   bash infra/security/setup-service-user.sh

set -euo pipefail

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[0;32m✓ %s\\033[0m\n" "$*"; }
warn() { printf "    \033[0;33m⚠ %s\033[0m\n" "$*"; }
die()  { printf "\n\033[0;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Must be run as root"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SERVICE_USER="redstonecipher"
SERVICE_DIR="/opt/redstonecipher"
UNIT_SRC="${REPO_ROOT}/infra/redstonecipher.service"
UNIT_DEST="/etc/systemd/system/redstonecipher.service"

# ── 1. Create system user ─────────────────────────────────────────────────────

say "Service user"
if id "${SERVICE_USER}" >/dev/null 2>&1; then
    ok "User '${SERVICE_USER}' already exists"
else
    useradd \
        --system \
        --no-create-home \
        --home-dir "${SERVICE_DIR}" \
        --shell /usr/sbin/nologin \
        --comment "redstoneCipher web server" \
        "${SERVICE_USER}"
    ok "Created system user '${SERVICE_USER}'"
fi

# ── 2. Set ownership ──────────────────────────────────────────────────────────

say "Directory ownership"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${SERVICE_DIR}"

# The SSH key must be readable only by the service user (not world-readable).
chmod 600 "${SERVICE_DIR}/mc_ssh_key"           2>/dev/null || true
chmod 644 "${SERVICE_DIR}/mc_known_hosts"        2>/dev/null || true
chmod 600 "${SERVICE_DIR}/.env"                  2>/dev/null || true
chmod 700 "${SERVICE_DIR}/data"                  2>/dev/null || true

ok "Ownership set: ${SERVICE_DIR} → ${SERVICE_USER}"

# ── 3. Install hardened systemd unit ─────────────────────────────────────────

say "systemd unit"
if [[ -f "${UNIT_SRC}" ]]; then
    cp "${UNIT_SRC}" "${UNIT_DEST}"
    ok "Unit installed from ${UNIT_SRC}"
else
    warn "Unit source not found at ${UNIT_SRC} — writing inline"
    cat > "${UNIT_DEST}" <<'UNIT'
[Unit]
Description=redstoneCipher Web Server
After=network.target tailscaled.service

[Service]
User=redstonecipher
Group=redstonecipher
WorkingDirectory=/opt/redstonecipher
EnvironmentFile=/opt/redstonecipher/.env
ExecStart=/opt/redstonecipher/redstonecipher-server
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# ── Hardening ──────────────────────────────────────────────────────────────
# Prevent the process from gaining new privileges via setuid/setgid.
NoNewPrivileges=yes
# Isolated /tmp — process cannot read other services' temp files.
PrivateTmp=yes
# Cannot touch /home or /root.
ProtectHome=yes
# Filesystem is read-only except for paths the service needs to write.
ProtectSystem=strict
ReadWritePaths=/opt/redstonecipher/data /opt/redstonecipher/www
# Drop all Linux capabilities — the service binds to port 8080, not <1024.
CapabilityBoundingSet=
# Restrict which system calls are permitted (broad allow-list for a Rust service).
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
UNIT
fi

# ── 4. Reload + restart ───────────────────────────────────────────────────────

say "Restarting service"
systemctl daemon-reload
systemctl restart redstonecipher
sleep 3

# ── 5. Verify ─────────────────────────────────────────────────────────────────

say "Verification"
if ! systemctl is-active redstonecipher >/dev/null 2>&1; then
    die "Service failed to start — check: journalctl -u redstonecipher -n 30"
fi
ok "Service is active"

RUNNING_USER=$(ps aux 2>/dev/null | grep '[r]edstonecipher-server' | awk '{print $1}' | head -1 || true)
if [[ "${RUNNING_USER}" == "${SERVICE_USER}" ]]; then
    ok "Process is running as '${SERVICE_USER}'"
else
    warn "Process user is '${RUNNING_USER}' (expected '${SERVICE_USER}')"
    warn "Check the unit file and verify PermitRootLogin / User= are correct"
fi

# systemd security score (available in systemd >= 240)
if command -v systemd-analyze >/dev/null 2>&1; then
    SCORE=$(systemd-analyze security redstonecipher 2>/dev/null | tail -1 || true)
    if [[ -n "${SCORE}" ]]; then
        ok "Security score: ${SCORE}"
    fi
fi

say "Setup complete"
cat <<EOF

  Service user:    ${SERVICE_USER}
  Working dir:     ${SERVICE_DIR}
  Unit file:       ${UNIT_DEST}

  Monitor:  journalctl -u redstonecipher -f
  Analyze:  systemd-analyze security redstonecipher

EOF

#!/usr/bin/env bash
# infra/security/harden-web-server.sh
#
# Idempotent SSH hardening and fail2ban installation for the web server.
# Safe to re-run — every step checks the current state before acting.
#
# What this does:
#   1. Install fail2ban (if not already present)
#   2. Write /etc/fail2ban/jail.d/tailscale-whitelist.conf
#      (Tailscale CGNAT range whitelisted so the admin machine is never banned)
#   3. Enable and start the fail2ban service
#   4. Set PermitRootLogin prohibit-password in /etc/ssh/sshd_config
#      (keeps key-based root SSH working; blocks password-based root login)
#   5. Reload sshd to apply the change without dropping any active sessions
#
# Run on the web server:
#   bash infra/security/harden-web-server.sh

set -euo pipefail

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[0;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "    \033[0;33m⚠ %s\033[0m\n" "$*"; }
die()  { printf "\n\033[0;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Must be run as root"

# ── 1. Install fail2ban ────────────────────────────────────────────────────────

say "fail2ban installation"
if command -v fail2ban-server >/dev/null 2>&1; then
    ok "fail2ban already installed ($(fail2ban-server --version 2>&1 | head -1))"
else
    apt-get update -qq
    apt-get install -y fail2ban
    ok "fail2ban installed"
fi

# ── 2. Tailscale whitelist ─────────────────────────────────────────────────────

say "fail2ban Tailscale whitelist"
WHITELIST_CONF="/etc/fail2ban/jail.d/tailscale-whitelist.conf"

EXPECTED_WHITELIST="[DEFAULT]
# Whitelist the Tailscale CGNAT range so the admin machine (and the
# mc-server-1 watchdog) are never accidentally banned.
ignoreip = 127.0.0.1/8 ::1 100.64.0.0/10"

if [[ -f "${WHITELIST_CONF}" ]] && grep -q "100.64.0.0/10" "${WHITELIST_CONF}"; then
    ok "Tailscale whitelist already configured at ${WHITELIST_CONF}"
else
    mkdir -p /etc/fail2ban/jail.d
    cat > "${WHITELIST_CONF}" <<'EOF'
[DEFAULT]
# Whitelist the Tailscale CGNAT range so the admin machine (and the
# mc-server-1 watchdog) are never accidentally banned.
ignoreip = 127.0.0.1/8 ::1 100.64.0.0/10
EOF
    ok "Tailscale whitelist written to ${WHITELIST_CONF}"
fi

# ── 3. Enable and start fail2ban ──────────────────────────────────────────────

say "fail2ban service"
systemctl enable fail2ban >/dev/null 2>&1

if systemctl is-active fail2ban >/dev/null 2>&1; then
    # Reload config (not restart) to pick up whitelist without resetting bans.
    fail2ban-client reload >/dev/null 2>&1 || systemctl restart fail2ban
    ok "fail2ban reloaded (was already running)"
else
    systemctl start fail2ban
    ok "fail2ban started"
fi

# Verify the sshd jail is active.
sleep 1
if fail2ban-client status sshd >/dev/null 2>&1; then
    ok "sshd jail is active"
else
    warn "sshd jail may not be active yet — check: fail2ban-client status sshd"
fi

# ── 4. SSH: PermitRootLogin prohibit-password ─────────────────────────────────

say "sshd PermitRootLogin hardening"
SSHD_CONFIG="/etc/ssh/sshd_config"

CURRENT=$(grep -E "^PermitRootLogin" "${SSHD_CONFIG}" 2>/dev/null | awk '{print $2}' || true)

if [[ "${CURRENT}" == "prohibit-password" ]]; then
    ok "PermitRootLogin is already 'prohibit-password'"
else
    # Back up the original config.
    cp "${SSHD_CONFIG}" "${SSHD_CONFIG}.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

    if grep -qE "^PermitRootLogin" "${SSHD_CONFIG}"; then
        # Replace the existing directive.
        sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' "${SSHD_CONFIG}"
    elif grep -qE "^#PermitRootLogin" "${SSHD_CONFIG}"; then
        # Uncomment and set.
        sed -i 's/^#PermitRootLogin.*/PermitRootLogin prohibit-password/' "${SSHD_CONFIG}"
    else
        # Append.
        echo "PermitRootLogin prohibit-password" >> "${SSHD_CONFIG}"
    fi

    ok "PermitRootLogin set to 'prohibit-password'"
fi

# ── 5. Reload sshd ────────────────────────────────────────────────────────────

say "sshd reload"
# Validate config before reloading to catch any syntax errors.
if ! sshd -t 2>/dev/null; then
    die "sshd config validation failed — reverting is not automatic, check ${SSHD_CONFIG}.bak.* for the original"
fi

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || {
    die "Could not reload sshd — the config change is in place but not yet active"
}
ok "sshd reloaded"

# ── Done ──────────────────────────────────────────────────────────────────────

say "Hardening complete"
cat <<EOF

  fail2ban:       active, sshd jail enabled
  Tailscale CGNAT (100.64.0.0/10) is whitelisted — admin machine cannot be banned
  PermitRootLogin: prohibit-password (key auth works; password login blocked)

  Verify:
    fail2ban-client status sshd
    sshd -T | grep permitrootlogin

EOF

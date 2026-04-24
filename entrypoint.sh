#!/usr/bin/env bash
# Container entrypoint for redstoneCipher on Cloud Run.
#
# Boot sequence:
#   1. Create writable runtime directories
#   2. Start tailscaled (userspace WireGuard; used for outbound SSH to MC VM)
#   3. Restore the SQLite database from GCS via Litestream
#   4. Start the Rust server under Litestream (port 8080 opens → Cloud Run
#      startup TCP probe passes immediately)
#   5. Join the tailnet in the background (for outbound `gcloud compute ssh
#      --tunnel-through-iap` to the Minecraft VM in example-project)
#
# Access control is handled by Google OAuth (JWT cookies), NOT by Tailscale
# IP checking.  Tailscale is only needed for the outbound IAP tunnel.
#
# Required env vars:
#   TS_AUTHKEY   — reusable+ephemeral auth key (Secret Manager → ts_authkey)
#   TS_HOSTNAME  — MagicDNS label (default: redstonecipher-web)
#   LITESTREAM_GCS_BUCKET

# Keep pipefail but drop errexit — we handle errors explicitly so the
# cleanup trap always fires even if an individual step fails.
set -uo pipefail

TS_HOSTNAME="${TS_HOSTNAME:-redstonecipher-web}"
TS_SOCKET=/var/run/tailscale/tailscaled.sock
TAILSCALED_PID=""
LITESTREAM_PID=""

# ── Shutdown handler ─────────────────────────────────────────────────────────────────────────
cleanup() {
    echo "[entrypoint] SIGTERM received — shutting down"

    # 1. Stop litestream (flushes pending WAL to GCS, then sends SIGTERM to
    #    the server child and waits for it to exit)
    if [ -n "${LITESTREAM_PID}" ]; then
        kill -TERM "${LITESTREAM_PID}" 2>/dev/null || true
        wait "${LITESTREAM_PID}" 2>/dev/null || true
    fi

    # 2. Log out of Tailscale so the ephemeral node is immediately removed
    #    from the tailnet.  Without this step the node lingers for ~2 min and
    #    the next container start has to take a numbered suffix (e.g. -1, -2).
    if [ -S "${TS_SOCKET}" ]; then
        tailscale --socket="${TS_SOCKET}" logout 2>/dev/null || true
        echo "[entrypoint] Tailscale node removed from tailnet"
    fi

    # 3. Kill tailscaled
    if [ -n "${TAILSCALED_PID}" ]; then
        kill "${TAILSCALED_PID}" 2>/dev/null || true
    fi
}
trap cleanup TERM INT

# ── 1. Writable directories ──────────────────────────────────────────────────────
mkdir -p /data/backups /tmp/gcloud-config /var/run/tailscale /var/lib/tailscale

# ── 2. Start tailscaled daemon (background) ─────────────────────────────────
tailscaled \
    --tun=userspace-networking \
    --statedir=/var/lib/tailscale \
    --socket="${TS_SOCKET}" \
    2>/dev/null &
TAILSCALED_PID=$!

# Give tailscaled up to 5 s to create its socket before we move on.
for i in $(seq 1 10); do [ -S "${TS_SOCKET}" ] && break; sleep 0.5; done

# ── 3. Restore SQLite from GCS (Litestream) ────────────────────────────────
if litestream restore -config /etc/litestream.yml -if-replica-exists /data/mc-manager.db 2>/dev/null; then
    echo "[entrypoint] Database restored from GCS replica"
else
    echo "[entrypoint] No GCS replica — starting with fresh database"
fi

# ── 4. Join tailnet in background (outbound SSH only) ───────────────────────────────
for i in $(seq 1 20); do [ -S "${TS_SOCKET}" ] && break; sleep 0.5; done
(
    tailscale --socket="${TS_SOCKET}" up \
        --auth-key="${TS_AUTHKEY}" \
        --hostname="${TS_HOSTNAME}" \
        --accept-routes=false \
        --accept-dns=false \
    && echo "[entrypoint] Tailscale connected (outbound SSH ready)" \
    || echo "[entrypoint] WARNING: Tailscale failed — MC VM SSH will not work" >&2
) &

# ── 5. Run server under Litestream ────────────────────────────────────────────────────
# Litestream runs in the background so the shell (PID 1) keeps its SIGTERM
# trap active.  Cloud Run sends SIGTERM to PID 1; the trap above gracefully
# stops litestream (flushes WAL), logs out of Tailscale (removes ephemeral
# node), then exits cleanly.
litestream replicate -config /etc/litestream.yml \
    -exec "/app/redstonecipher-server" &
LITESTREAM_PID=$!

# Wait for litestream (and therefore the server) to exit
wait "${LITESTREAM_PID}"
EXIT_CODE=$?
echo "[entrypoint] Server exited with code ${EXIT_CODE}"
exit "${EXIT_CODE}"

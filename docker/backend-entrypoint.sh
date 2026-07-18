#!/usr/bin/env bash
# Backend entrypoint. Bootstraps SSH access to the mc container, then starts the
# server. The backend controls Minecraft over SSH, so on first run it generates
# a keypair, shares the public half with the mc container through a shared
# volume, and pins the mc container's host key.
set -euo pipefail

RS_DIR=/opt/redstonecipher
KEY="$RS_DIR/mc_ssh_key"
KNOWN="$RS_DIR/mc_known_hosts"
SHARED=/keys
MC_HOST="${TAILSCALE_IP:-mc}"

mkdir -p "$RS_DIR/data" "$RS_DIR/www/map" "$SHARED"

# 1. Generate the control keypair once (persisted on the volume).
if [ ! -f "$KEY" ]; then
  echo "[entrypoint] generating mc control key"
  ssh-keygen -t ed25519 -N '' -f "$KEY" -C redstonecipher-backend >/dev/null
fi
cp "$KEY.pub" "$SHARED/backend.pub"

# 2. Wait for the mc container's sshd, then pin its host key.
echo "[entrypoint] waiting for $MC_HOST:22"
until nc -z "$MC_HOST" 22 2>/dev/null; do sleep 2; done
ssh-keyscan -t ed25519 "$MC_HOST" > "$KNOWN" 2>/dev/null
echo "[entrypoint] mc host key pinned; starting backend"

exec redstonecipher-server

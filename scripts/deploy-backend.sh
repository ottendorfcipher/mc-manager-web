#!/usr/bin/env bash
# Build the Rust backend on the production server and swap the binary atomically.
#
# Steps:
#   1. rsync source, migrations, and Cargo files to the server
#   2. cargo build --release on the server
#   3. Stop the service, swap the binary, start the service
#      (stop→copy→start avoids "Text file busy" when overwriting a running binary)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SERVER="root@178.105.43.199"
REMOTE_SRC="/opt/redstonecipher/backend"
REMOTE_BIN="/opt/redstonecipher/redstonecipher-server"
BUILD_BIN="${REMOTE_SRC}/target/release/redstonecipher-server"

echo "==> Syncing source to ${WEB_SERVER}..."
rsync -az \
  "${REPO_ROOT}/backend/src/" \
  "${REPO_ROOT}/backend/Cargo.toml" \
  "${REPO_ROOT}/backend/Cargo.lock" \
  "${WEB_SERVER}:${REMOTE_SRC}/Cargo.toml" \
  "${WEB_SERVER}:${REMOTE_SRC}/Cargo.lock"

rsync -az "${REPO_ROOT}/backend/src/"     "${WEB_SERVER}:${REMOTE_SRC}/src/"
rsync -az "${REPO_ROOT}/backend/migrations/" "${WEB_SERVER}:${REMOTE_SRC}/migrations/"

echo "==> Building release binary on ${WEB_SERVER}..."
# shellcheck disable=SC2029
ssh "${WEB_SERVER}" "cd ${REMOTE_SRC} && cargo build --release"

echo "==> Swapping binary and restarting service..."
ssh "${WEB_SERVER}" "
  systemctl stop redstonecipher && \
  cp '${BUILD_BIN}' '${REMOTE_BIN}' && \
  systemctl start redstonecipher && \
  echo 'Service restarted.' && \
  journalctl -u redstonecipher -n 5 --no-pager
"

echo "==> Done."

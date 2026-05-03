#!/usr/bin/env bash
# Deploy the React frontend to the web server.
# Excludes /map/ so BlueMap tiles are never deleted by a frontend deploy.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SERVER="root@203.0.113.10"
REMOTE_DIR="/opt/redstonecipher/www"

cd "$REPO_ROOT/frontend"
echo "Building frontend..."
npm run build

echo "Deploying to ${WEB_SERVER}:${REMOTE_DIR} (excluding /map/)..."
rsync -az --delete \
  --exclude '/map' \
  dist/ \
  "${WEB_SERVER}:${REMOTE_DIR}/"

echo "Done."

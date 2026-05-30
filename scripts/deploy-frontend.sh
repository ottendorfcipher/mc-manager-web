#!/usr/bin/env bash
# Deploy the React frontend to the web server.
#
# The web server's www/ dir holds both static frontend assets AND
# runtime-generated files (resource-pack.zip, packs/, uploads/, map/).
# A naive `rsync --delete` would wipe the runtime files — each of the
# excludes below protects one such category.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SERVER="root@178.105.43.199"
REMOTE_DIR="/opt/redstonecipher/www"

cd "$REPO_ROOT/frontend"
echo "Building frontend..."
npm run build

echo "Deploying to ${WEB_SERVER}:${REMOTE_DIR}..."
rsync -az --delete \
  --exclude '/map' \
  --exclude '/packs' \
  --exclude '/uploads' \
  --exclude '/resource-pack.zip' \
  dist/ \
  "${WEB_SERVER}:${REMOTE_DIR}/"

echo "Done."

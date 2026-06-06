#!/usr/bin/env bash
# Deploy the React frontend to the web server.
#
# Two modes:
#   (default)   Build locally and deploy — fast dev iteration.
#   --from-ci   Download the CI-built, provenance-attested dist artifact,
#               verify every file's SHA-256, then deploy. Use this for releases
#               so production serves exactly what CI built and attested.
#
# The web server's www/ dir holds both static frontend assets AND
# runtime-generated files (resource-pack.zip, packs/, uploads/, map/).
# A naive `rsync --delete` would wipe the runtime files — each exclude below
# protects one such category.
#
# Usage:
#   scripts/deploy-frontend.sh                 # local build + deploy
#   scripts/deploy-frontend.sh --from-ci       # verified CI artifact for HEAD
#   scripts/deploy-frontend.sh --from-ci <sha> # verified CI artifact for a commit
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SERVER="root@178.105.43.199"
REMOTE_DIR="/opt/redstonecipher/www"
SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=5)

say() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
die() { printf "\n\033[0;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

DIST_DIR="$REPO_ROOT/frontend/dist"
CLEANUP=""
trap '[ -n "$CLEANUP" ] && rm -rf "$CLEANUP"' EXIT

if [[ "${1:-}" == "--from-ci" ]]; then
  command -v gh >/dev/null 2>&1 || die "gh CLI required for --from-ci."
  SHA="${2:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
  TMP="$(mktemp -d)"; CLEANUP="$TMP"
  say "Downloading frontend artifact for commit ${SHA:0:12}..."
  gh run download --repo ottendorfcipher/mc-manager-web --name "frontend-${SHA}" --dir "$TMP" \
    || die "No artifact 'frontend-${SHA}'. Has the Release Build workflow finished?"

  say "Verifying provenance attestation..."
  gh attestation verify "$TMP/dist.sha256" --repo ottendorfcipher/mc-manager-web \
    && printf "    provenance OK\n" \
    || printf "\033[0;33m    ⚠ provenance not verified (continuing — file checksums verified next)\033[0m\n"

  say "Verifying per-file SHA-256 of dist..."
  ( cd "$TMP/dist" && \
    if command -v sha256sum >/dev/null 2>&1; then sha256sum -c ../dist.sha256 --quiet;
    else shasum -a 256 -c ../dist.sha256; fi ) \
    || die "dist checksum verification FAILED — refusing to deploy."
  printf "    all files verified\n"
  DIST_DIR="$TMP/dist"
else
  cd "$REPO_ROOT/frontend"
  say "Building frontend locally..."
  npm run build
fi

say "Deploying to ${WEB_SERVER}:${REMOTE_DIR}..."
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude '/map' \
  --exclude '/packs' \
  --exclude '/uploads' \
  --exclude '/resource-pack.zip' \
  "$DIST_DIR/" \
  "${WEB_SERVER}:${REMOTE_DIR}/"

ssh "${SSH_OPTS[@]}" "${WEB_SERVER}" "chown -R redstonecipher:redstonecipher ${REMOTE_DIR}/"

say "Done."

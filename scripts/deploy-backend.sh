#!/usr/bin/env bash
# Deploy the backend by shipping a CI-built, checksum-verified binary.
#
# The production server NO LONGER compiles the backend. The release binary is
# built in GitHub Actions (.github/workflows/release.yml) from the exact,
# committed, --locked dependency set, attested with build provenance, and
# published as an artifact. This script:
#
#   1. Downloads the backend artifact for a given commit (default: HEAD)
#   2. Verifies its SHA-256 LOCALLY against the checksum CI produced
#   3. (optional) Verifies the build-provenance attestation with `gh`
#   4. rsyncs the binary + checksum to the server over SSH (never scp)
#   5. Re-verifies the SHA-256 ON THE SERVER before swapping
#   6. Atomically swaps the binary (stop -> cp -> start) and tails the log
#
# Result: the prod host needs no rustc/cargo and never touches crates.io.
#
# Requirements (local): gh (authenticated), rsync, ssh, sha256sum/shasum.
# Usage:
#   scripts/deploy-backend.sh                 # deploy artifact for current HEAD
#   scripts/deploy-backend.sh <commit-sha>    # deploy artifact for a specific commit
#
# Fallback: if you must build on the server (no CI artifact available), pass
#   DEPLOY_BUILD_ON_SERVER=1 scripts/deploy-backend.sh
# which restores the legacy in-place build. Prefer the verified path.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SERVER="root@203.0.113.10"
REMOTE_SRC="/opt/redstonecipher/backend"
REMOTE_BIN="/opt/redstonecipher/redstonecipher-server"
SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=5)

SHA="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
die()  { printf "\n\033[0;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

sha256_of() { # portable sha256 of a file -> bare hex
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# ── Legacy fallback: build on the server (discouraged) ──────────────────────────
if [[ "${DEPLOY_BUILD_ON_SERVER:-0}" == "1" ]]; then
  say "LEGACY MODE: building on the server (no provenance). Prefer the CI artifact path."
  ssh "${SSH_OPTS[@]}" "${WEB_SERVER}" "bash -s" < "${REPO_ROOT}/scripts/setup-nginx.sh" || true
  rsync -az -e "ssh ${SSH_OPTS[*]}" "${REPO_ROOT}/backend/Cargo.toml" "${REPO_ROOT}/backend/Cargo.lock" "${WEB_SERVER}:${REMOTE_SRC}/"
  rsync -az -e "ssh ${SSH_OPTS[*]}" "${REPO_ROOT}/backend/src/"        "${WEB_SERVER}:${REMOTE_SRC}/src/"
  rsync -az -e "ssh ${SSH_OPTS[*]}" "${REPO_ROOT}/backend/migrations/" "${WEB_SERVER}:${REMOTE_SRC}/migrations/"
  ssh "${SSH_OPTS[@]}" "${WEB_SERVER}" "cd ${REMOTE_SRC} && cargo build --release --locked && \
    systemctl stop redstonecipher && cp '${REMOTE_SRC}/target/release/redstonecipher-server' '${REMOTE_BIN}' && \
    systemctl start redstonecipher && journalctl -u redstonecipher -n 5 --no-pager"
  exit 0
fi

command -v gh >/dev/null 2>&1 || die "gh CLI required. Install it, or use DEPLOY_BUILD_ON_SERVER=1."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 1. Download the CI artifact for this commit ─────────────────────────────────
say "Downloading backend artifact for commit ${SHA:0:12}..."
gh run download --repo ottendorfcipher/mc-manager-web --name "backend-${SHA}" --dir "$TMP" \
  || die "No artifact 'backend-${SHA}'. Has the Release Build workflow finished for this commit?"

BIN="$TMP/redstonecipher-server"
SUM="$TMP/redstonecipher-server.sha256"
[[ -f "$BIN" && -f "$SUM" ]] || die "Artifact missing binary or checksum."

# ── 2. Verify checksum locally ──────────────────────────────────────────────────
say "Verifying SHA-256 locally..."
EXPECTED="$(awk '{print $1}' "$SUM")"
ACTUAL="$(sha256_of "$BIN")"
[[ "$EXPECTED" == "$ACTUAL" ]] || die "Local checksum mismatch! expected=$EXPECTED actual=$ACTUAL"
printf "    OK %s\n" "$ACTUAL"

# ── 3. Verify build provenance (best-effort; warns if unavailable) ──────────────
say "Verifying build provenance attestation..."
gh attestation verify "$BIN" --repo ottendorfcipher/mc-manager-web \
  && printf "    provenance OK\n" \
  || printf "\033[0;33m    ⚠ provenance not verified (continuing — checksum already verified)\033[0m\n"

# ── 4. Ship to the server (rsync over SSH) ──────────────────────────────────────
say "Uploading verified binary to ${WEB_SERVER}..."
ssh "${SSH_OPTS[@]}" "${WEB_SERVER}" "mkdir -p ${REMOTE_SRC}"
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BIN" "$SUM" "${WEB_SERVER}:${REMOTE_SRC}/incoming/"

# ── 5+6. Re-verify on server, then atomic swap ──────────────────────────────────
say "Re-verifying on server and swapping..."
ssh "${SSH_OPTS[@]}" "${WEB_SERVER}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE_SRC}/incoming"
exp="\$(awk '{print \$1}' redstonecipher-server.sha256)"
act="\$(sha256sum redstonecipher-server | awk '{print \$1}')"
[ "\$exp" = "\$act" ] || { echo "SERVER checksum mismatch! exp=\$exp act=\$act" >&2; exit 1; }
echo "    server checksum OK \$act"
chmod +x redstonecipher-server
systemctl stop redstonecipher
cp redstonecipher-server "${REMOTE_BIN}"
chown redstonecipher:redstonecipher "${REMOTE_BIN}"
systemctl start redstonecipher
sleep 1
systemctl is-active redstonecipher && echo "    service active"
journalctl -u redstonecipher -n 6 --no-pager
EOF

say "Done — deployed verified binary for ${SHA:0:12}."

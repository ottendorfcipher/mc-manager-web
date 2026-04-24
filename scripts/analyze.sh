#!/usr/bin/env bash
# SonarQube-style analysis for this repo.
# Signals covered:
#   - TypeScript strictness  (tsc --noEmit)
#   - Lint + Sonar rules     (eslint with sonarjs plugin)
#   - Duplication            (jscpd)
#   - Type coverage          (type-coverage, at-least 95%)
#   - Dead code / exports    (knip)
#   - Rust lints             (cargo clippy -D warnings)
#   - Rust advisories        (cargo audit, installed on demand)
#
# Exit code is the first non-zero tool. Runs every tool so you see all signal
# in one go, rather than stopping at the first failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"

c_red='\033[0;31m'
c_green='\033[0;32m'
c_bold='\033[1m'
c_reset='\033[0m'

overall_rc=0

section() {
  printf "\n${c_bold}==> %s${c_reset}\n" "$1"
}

run() {
  local name="$1"; shift
  section "$name"
  if "$@"; then
    printf "${c_green}%s ok${c_reset}\n" "$name"
  else
    printf "${c_red}%s FAILED${c_reset}\n" "$name"
    overall_rc=1
  fi
}

# ── Frontend ──────────────────────────────────────────────────────────────────
cd "$FRONTEND"

run "tsc --noEmit"         npx --no-install tsc --noEmit -p tsconfig.app.json
run "eslint (errors)"      npx --no-install eslint .
run "jscpd (duplication)"  npx --no-install jscpd src
run "type-coverage ≥95%"   npx --no-install type-coverage -p tsconfig.app.json --at-least 95 --strict
run "knip (dead code)"     npx --no-install knip

# ── Backend ───────────────────────────────────────────────────────────────────
cd "$BACKEND"

run "clippy -D warnings"   cargo clippy --all-targets --all-features -- -D warnings

if ! command -v cargo-audit >/dev/null 2>&1; then
  section "installing cargo-audit"
  cargo install cargo-audit --quiet || true
fi
if command -v cargo-audit >/dev/null 2>&1; then
  run "cargo audit"        cargo audit
else
  printf "${c_red}cargo audit unavailable; skipping${c_reset}\n"
fi

exit "$overall_rc"

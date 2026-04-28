#!/usr/bin/env bash
# scripts/security-check.sh
#
# SonarQube-style static-analysis + CVE sweep.  Runs locally or in CI.
#
# Checks:
#   1. cargo audit     — Rust dependency CVE scan (RustSec advisory DB)
#   2. cargo clippy    — Rust linter (deny all warnings = must-fix quality gate)
#   3. npm audit       — Node/frontend dependency CVE scan
#   4. semgrep         — OWASP-aligned SAST over Rust + TypeScript source
#
# Usage:
#   bash scripts/security-check.sh
#   SKIP_SEMGREP=1 scripts/security-check.sh   # skip semgrep (offline / fast mode)
#
# Exit code: 0 = all clean, non-zero = at least one check failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────
say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓ PASSED: %s\033[0m\n" "$*"; ((PASS++)); }
fail() { printf "  \033[0;31m✗ FAILED: %s\033[0m\n" "$*"; ((FAIL++)); }

run() {
  local name="$1"; shift
  say "$name"
  if "$@"; then
    ok "$name"
  else
    fail "$name"
  fi
}

# ── 1. Rust: dependency CVE scan ──────────────────────────────────────────────
say "Checking for cargo-audit…"
if ! command -v cargo-audit &>/dev/null; then
  echo "  Installing cargo-audit…"
  cargo install cargo-audit --quiet 2>&1 | tail -3
fi
run "cargo audit — Rust dependency CVE scan" \
  cargo audit --file "$ROOT_DIR/backend/Cargo.lock"

# ── 2. Rust: linter (deny warnings) ──────────────────────────────────────────
run "cargo clippy — Rust linter (deny warnings)" \
  bash -c "cd '$ROOT_DIR/backend' && cargo clippy --all-targets --all-features -- -D warnings 2>&1"

# ── 3. Node: dependency CVE scan ─────────────────────────────────────────────
run "npm audit — Node CVE scan (moderate+)" \
  bash -c "cd '$ROOT_DIR/frontend' && npm audit --audit-level=moderate 2>&1"

# ── 4. SAST: semgrep ─────────────────────────────────────────────────────────
if [[ "${SKIP_SEMGREP:-0}" == "1" ]]; then
  printf "\n\033[0;33m⚠ Skipping semgrep (SKIP_SEMGREP=1)\033[0m\n"
else
  say "semgrep — OWASP SAST (auto config)"
  if ! command -v semgrep &>/dev/null; then
    echo "  semgrep not found. Install with:"
    echo "    pip install semgrep   # or: brew install semgrep"
    fail "semgrep — not installed"
  else
    if semgrep --config=auto \
               --include="*.rs" \
               --include="*.ts" \
               --include="*.tsx" \
               --error \
               --quiet \
               "$ROOT_DIR"; then
      ok "semgrep — OWASP SAST"
    else
      fail "semgrep — OWASP SAST (findings above)"
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n\033[1m──────────────────────────────────────────\033[0m\n"
printf "\033[1m%d passed, %d failed\033[0m\n" "$PASS" "$FAIL"

if [[ $FAIL -gt 0 ]]; then
  printf "\033[0;31mSecurity check FAILED — fix the issues above before merging.\033[0m\n"
  exit 1
fi

printf "\033[0;32mAll security checks passed.\033[0m\n"
exit 0

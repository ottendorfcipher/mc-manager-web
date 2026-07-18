#!/usr/bin/env bash
# Enable GitHub-native security features for the repo.
#
# NOTE (2026-06): GitHub native secret scanning + push protection is NOT
# available on this PRIVATE repository without GitHub Advanced Security (paid).
# Until then, secret scanning is provided by .github/workflows/secret-scan.yml
# (gitleaks), which runs on every push/PR and weekly over full history.
#
# Run this script if the repo is ever made public, or once GHAS is enabled, to
# turn on the native controls (defense-in-depth on top of the gitleaks job).
#
# Requires: gh CLI authenticated with admin on the repo.
set -euo pipefail
REPO="${1:-your-org/redstonecipher}"

echo "==> Enabling secret scanning + push protection on ${REPO}..."
gh api -X PATCH "repos/${REPO}" \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
  --jq '.security_and_analysis' \
  || {
    echo "WARNING: native secret scanning unavailable (private repo without GHAS)."
    echo "         The gitleaks workflow remains the active secret-scanning control."
    exit 0
  }

echo "==> Enabling Dependabot security updates..."
gh api -X PUT "repos/${REPO}/automated-security-fixes" >/dev/null 2>&1 \
  && echo "    Dependabot security fixes enabled" \
  || echo "    (could not toggle Dependabot security fixes — enable in repo settings)"

echo "Done."

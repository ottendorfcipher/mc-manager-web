#!/usr/bin/env bash
# Enable GitHub-native security features for the repo.
#
# NOTE (2026-11): the repo is public, so GitHub native secret scanning and
# push protection are available and enabled. The gitleaks workflow
# (secret-scan.yml) was removed; .gitleaks.toml is kept for local runs:
#   gitleaks git . --config .gitleaks.toml --redact
#
# Run this script to re-apply the native controls, for example after the
# repo changes visibility. On a private repo without GitHub Advanced
# Security they are unavailable and no secret scan runs in CI.
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
    echo "         No secret scan runs in CI: run gitleaks locally (.gitleaks.toml)."
    exit 0
  }

echo "==> Enabling Dependabot security updates..."
gh api -X PUT "repos/${REPO}/automated-security-fixes" >/dev/null 2>&1 \
  && echo "    Dependabot security fixes enabled" \
  || echo "    (could not toggle Dependabot security fixes — enable in repo settings)"

echo "Done."

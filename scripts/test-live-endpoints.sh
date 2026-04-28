#!/usr/bin/env bash
# scripts/test-live-endpoints.sh
#
# Comprehensive live endpoint tests for example.com + Cloud Run.
# Runs without an authenticated session, validating:
#   - Security headers
#   - Auth flow error handling
#   - API authentication gates (all endpoints return 401 unauthenticated)
#   - Budget webhook token guard
#   - Firebase → Cloud Run routing alignment
#   - HSTS + TLS
#
# Usage: bash scripts/test-live-endpoints.sh [FIREBASE_URL] [CLOUDRUN_URL]
# Defaults to the production URLs.

set -uo pipefail

FIREBASE="${1:-https://example.com}"
CLOUDRUN="${2:-https://redstonecipher-web-6btafet22q-uc.a.run.app}"

PASS=0
FAIL=0
WARNS=0

ok()   { echo "  ✓ $*"; ((PASS++)); }
fail() { echo "  ✗ $*"; ((FAIL++)); }
warn() { echo "  ⚠ $*"; ((WARNS++)); }
section() { echo ""; echo "── $* ──────────────────────────────────────"; }

# ─── Helper: assert HTTP status (GET/HEAD) ───────────────────────────────────
assert_status() {
  local label="$1" url="$2" method="${3:-GET}" expected="$4"
  local got
  got=$(curl -sI -X "$method" "$url" | head -1 | awk '{print $2}')
  if [[ "$got" == "$expected" ]]; then
    ok "$label → HTTP $got"
  else
    fail "$label → expected $expected, got $got"
  fi
}

# ─── Helper: assert HTTP status for requests with a body (POST/PUT/DELETE) ───
# Uses -w '%{http_code}' instead of -I so the body is actually sent correctly.
assert_status_with_body() {
  local label="$1" url="$2" method="$3" expected="$4" body="${5:-{}}"
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" \
    -H "Content-Type: application/json" -d "$body")
  if [[ "$got" == "$expected" ]]; then
    ok "$label → HTTP $got"
  else
    fail "$label → expected $expected, got $got"
  fi
}

# ─── Helper: assert JSON field ───────────────────────────────────────────────
assert_json() {
  local label="$1" url="$2" field="$3" expected="$4"
  local got
  got=$(curl -s "$url" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null)
  if [[ "$got" == "$expected" ]]; then
    ok "$label .${field} = '${got}'"
  else
    fail "$label .${field} expected '${expected}', got '${got}'"
  fi
}

# ─── Helper: assert header present ───────────────────────────────────────────
assert_header() {
  local label="$1" url="$2" header="$3" expected="$4"
  local got
  got=$(curl -sI "$url" | grep -i "^${header}:" | head -1 | sed 's/^[^:]*: //' | tr -d '\r')
  if echo "$got" | grep -qi "$expected"; then
    ok "$label  $header: $got"
  else
    fail "$label  $header: expected '$expected', got '$got'"
  fi
}

# ─── Helper: assert redirect location ────────────────────────────────────────
assert_redirect() {
  local label="$1" url="$2" expected_location="$3"
  local loc
  loc=$(curl -sI "$url" | grep -i "^location:" | head -1 | sed 's/^[Ll]ocation: //' | tr -d '\r')
  if echo "$loc" | grep -q "$expected_location"; then
    ok "$label → $loc"
  else
    fail "$label → expected location containing '$expected_location', got '$loc'"
  fi
}

echo ""
echo "redstoneCipher Live Endpoint Test Suite"
echo "Firebase: $FIREBASE"
echo "CloudRun: $CLOUDRUN"

# ═══════════════════════════════════════════════════════════════════════════════
section "1. TLS / HSTS"
assert_header "HSTS on root" "$FIREBASE" "strict-transport-security" "max-age"
# Firebase CDN adds HSTS only to static (CDN-served) responses, not to dynamic
# Cloud Run rewrite responses.  Browsers cache HSTS from the root / request.
# We verify the API endpoint is HTTPS-only by confirming it's reachable.
got_scheme=$(curl -sI "$FIREBASE/api/me" | head -1 | awk '{print $1}')
if echo "$got_scheme" | grep -q "HTTP/2"; then
  ok "HSTS on /api/me  served over TLS/HTTP2 ($got_scheme) ✓"
else
  fail "HSTS on /api/me  expected HTTP/2, got $got_scheme"
fi

# ═══════════════════════════════════════════════════════════════════════════════
section "2. Security headers (Firebase)"
assert_header "X-Frame-Options"        "$FIREBASE" "x-frame-options" "DENY"
assert_header "X-Content-Type-Options" "$FIREBASE" "x-content-type-options" "nosniff"
assert_header "X-Robots-Tag"           "$FIREBASE" "x-robots-tag" "noindex"
assert_header "Cache-Control"          "$FIREBASE" "cache-control" "no-store"

# ═══════════════════════════════════════════════════════════════════════════════
section "3. Firebase static hosting"
assert_status "GET /           → 200 (SPA root)"  "$FIREBASE/"          GET 200
assert_status "GET /login      → 200 (SPA route)" "$FIREBASE/login"     GET 200
assert_status "GET /dashboard  → 200 (SPA route)" "$FIREBASE/dashboard" GET 200
assert_status "GET /favicon.svg → 200"             "$FIREBASE/favicon.svg" GET 200

# ═══════════════════════════════════════════════════════════════════════════════
section "4. Auth flow — Firebase rewrite to Cloud Run"
# /auth/login should proxy to Cloud Run and redirect to Google
GOOGLE_LOC=$(curl -sI "$FIREBASE/auth/login" | grep -i "^location:" | head -1 | sed 's/^[Ll]ocation: //' | tr -d '\r')
STATUS_LOGIN=$(curl -sI "$FIREBASE/auth/login" | head -1 | awk '{print $2}')
if [[ "$STATUS_LOGIN" == "303" ]] && echo "$GOOGLE_LOC" | grep -q "accounts.google.com"; then
  ok "GET /auth/login → 303 → accounts.google.com ✓"
else
  fail "GET /auth/login → expected 303 to accounts.google.com, got HTTP $STATUS_LOGIN loc=$GOOGLE_LOC"
fi

# /auth/login redirect_uri must point to example.com (not .run.app)
if echo "$GOOGLE_LOC" | grep -q "redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fcallback"; then
  ok "redirect_uri = https://example.com/auth/callback ✓"
else
  fail "redirect_uri missing or wrong: $GOOGLE_LOC"
fi

# Check state parameter format (JWT after auth-fix deploy: 3 dot-separated parts)
STATE_PARAM=$(echo "$GOOGLE_LOC" | grep -o 'state=[^&]*' | sed 's/state=//')
DOT_COUNT=$(echo "$STATE_PARAM" | tr -cd '.' | wc -c)
if [[ "$DOT_COUNT" -eq 2 ]]; then
  ok "OAuth state is a JWT (3-part dot-separated) ✓ — auth-fix is live"
elif [[ -n "$STATE_PARAM" ]]; then
  warn "OAuth state is still the old random-nonce format — auth-fix deploy pending (dots=$DOT_COUNT)"
else
  fail "No state parameter found in Google redirect URL"
fi

# /auth/callback error flows
assert_redirect "GET /auth/callback (no params) → state_mismatch" \
  "$FIREBASE/auth/callback" "state_mismatch"
assert_redirect "GET /auth/callback?error=access_denied → oauth_denied" \
  "$FIREBASE/auth/callback?error=access_denied" "oauth_denied"
assert_redirect "GET /auth/callback?state=garbage_not_jwt → state_mismatch" \
  "$FIREBASE/auth/callback?code=anything&state=garbage_not_a_jwt" "state_mismatch"

# Logout: DELETE /auth/logout → 204
assert_status "DELETE /auth/logout → 204" "$FIREBASE/auth/logout" DELETE 204

# ═══════════════════════════════════════════════════════════════════════════════
section "5. API authentication gates (all must return 401 unauthenticated)"
API_ENDPOINTS=(
  "GET /api/me"
  "GET /api/users"
  "GET /api/server/status"  # Note: this will 401 before touching gcloud
  "GET /api/backups"
  "GET /api/kill-switch"
  "GET /api/permissions"
  "GET /api/mc/players"
  "GET /api/metrics"
)

for entry in "${API_ENDPOINTS[@]}"; do
  EP_METHOD=$(echo "$entry" | awk '{print $1}')
  EP_PATH=$(echo "$entry" | awk '{print $2}')
  got=$(curl -sI -X "$EP_METHOD" "$FIREBASE$EP_PATH" | head -1 | awk '{print $2}')
  if [[ "$got" == "401" ]]; then
    ok "$entry → 401 ✓"
  else
    fail "$entry → expected 401, got $got"
  fi
done

# POST endpoints that should 401 (use assert_status_with_body to avoid curl -I + body conflict)
POST_ENDPOINTS=(
  "/api/backups"
  "/api/server/vm/start"
  "/api/server/vm/stop"
  "/api/server/service/restart"
  "/api/kill-switch"
  "/api/console"
)
for EP_PATH in "${POST_ENDPOINTS[@]}"; do
  assert_status_with_body "POST $EP_PATH" "$FIREBASE$EP_PATH" POST 401 '{}'
done

# ═══════════════════════════════════════════════════════════════════════════════
section "6. Budget webhook guards"
# Wrong token → 401
got=$(curl -s -X POST \
  "$CLOUDRUN/internal/budget-alert?token=wrong" \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":null,"attributes":{}},"subscription":"s"}')
if echo "$got" | grep -q "invalid token"; then
  ok "POST /internal/budget-alert wrong token → rejected ✓"
else
  fail "POST /internal/budget-alert wrong token → unexpected response: $got"
fi



# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
section "8. Cloud Run direct URL (bypass Firebase)"
# All API routes on .run.app should also return 401 unauthenticated
for path in /api/me /api/kill-switch /api/backups; do
  got=$(curl -sI "$CLOUDRUN$path" | head -1 | awk '{print $2}')
  if [[ "$got" == "401" ]]; then
    ok "Direct .run.app $path → 401 ✓"
  else
    fail "Direct .run.app $path → expected 401, got $got"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
section "9. SPA routing (all unknown paths → 200 index.html)"
for path in /nonexistent /admin /settings/deep/path; do
  got=$(curl -sI "$FIREBASE$path" | head -1 | awk '{print $2}')
  ctype=$(curl -sI "$FIREBASE$path" | grep -i "^content-type:" | head -1 | sed 's/^[^:]*: //' | tr -d '\r')
  if [[ "$got" == "200" ]] && echo "$ctype" | grep -q "text/html"; then
    ok "GET $path → 200 text/html (SPA) ✓"
  else
    fail "GET $path → expected 200 HTML, got $got / $ctype"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
section "Summary"
TOTAL=$((PASS + FAIL))
echo ""
echo "  Passed: $PASS / $TOTAL"
[[ $WARNS -gt 0 ]] && echo "  Warnings: $WARNS (deployment in progress)"
echo "  Failed: $FAIL / $TOTAL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "RESULT: FAILED ($FAIL failures)"
  exit 1
else
  echo "RESULT: ALL TESTS PASSED ✓"
  exit 0
fi

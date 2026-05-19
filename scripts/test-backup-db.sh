#!/usr/bin/env bash
# scripts/test-backup-db.sh
#
# Tests for backup-db.sh. Uses a temporary SQLite DB so no live data is touched.
# Run from the repo root: bash scripts/test-backup-db.sh
#
# Exit code: 0 = all tests pass, non-zero = at least one failure.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

# ── Test helpers ───────────────────────────────────────────────────────────────

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

# ── Fixture setup ──────────────────────────────────────────────────────────────

TMPDIR_ROOT=$(mktemp -d)
cleanup() { rm -rf "${TMPDIR_ROOT}"; }
trap cleanup EXIT

TEST_DB="${TMPDIR_ROOT}/test.db"
TEST_BACKUP_DIR="${TMPDIR_ROOT}/backups"

# Create a minimal SQLite DB for testing.
sqlite3 "${TEST_DB}" "CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);"

BACKUP_SCRIPT="$(cd "$(dirname "$0")" && pwd)/backup-db.sh"

run_backup() {
    # Run backup-db.sh with all paths redirected to temp dirs.
    DB_PATH="${TEST_DB}" \
    BACKUP_DIR="${TEST_BACKUP_DIR}" \
    SSH_KEY="/nonexistent/key" \
    RETENTION_DAYS=1 \
    bash "${BACKUP_SCRIPT}" 2>&1
}

# ── Test 1: Backup creates a file ─────────────────────────────────────────────

echo ""
echo "=== Test 1: Backup creates a timestamped file ==="
run_backup > /dev/null
BACKUPS=$(find "${TEST_BACKUP_DIR}" -name "mc-manager-*.sqlite3" 2>/dev/null | wc -l)
if [[ "${BACKUPS}" -ge 1 ]]; then
    pass "Backup file was created in ${TEST_BACKUP_DIR}"
else
    fail "No backup file found in ${TEST_BACKUP_DIR}"
fi

# ── Test 2: Backup file is a valid SQLite database ────────────────────────────

echo ""
echo "=== Test 2: Backup file is a valid SQLite database ==="
BACKUP_FILE=$(find "${TEST_BACKUP_DIR}" -name "mc-manager-*.sqlite3" | head -1)
if sqlite3 "${BACKUP_FILE}" "SELECT COUNT(*) FROM t;" 2>/dev/null | grep -q "1"; then
    pass "Backup file is readable and contains the expected data"
else
    fail "Backup file is not a valid SQLite database or missing data"
fi

# ── Test 3: Integrity check passes ────────────────────────────────────────────

echo ""
echo "=== Test 3: Integrity check on backup ==="
if sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" 2>/dev/null | grep -q "^ok$"; then
    pass "PRAGMA integrity_check returned ok"
else
    fail "PRAGMA integrity_check failed on backup"
fi

# ── Test 4: Old backups are pruned ────────────────────────────────────────────

echo ""
echo "=== Test 4: Retention pruning removes old files ==="
# Create a fake old backup (touch with a timestamp 2 days old).
OLD_BACKUP="${TEST_BACKUP_DIR}/mc-manager-20200101T000000Z.sqlite3"
cp "${BACKUP_FILE}" "${OLD_BACKUP}"
touch -d "2 days ago" "${OLD_BACKUP}" 2>/dev/null || \
    touch -t "$(date -v-2d '+%Y%m%d%H%M.%S' 2>/dev/null || date --date='2 days ago' '+%Y%m%d%H%M.%S')" "${OLD_BACKUP}" 2>/dev/null || \
    { skip "Old backup pruning" "touch -d not supported on this platform"; }

if [[ "${SKIP}" -eq 0 ]]; then
    run_backup > /dev/null
    if [[ ! -f "${OLD_BACKUP}" ]]; then
        pass "Old backup was pruned by retention policy"
    else
        fail "Old backup was NOT pruned — retention policy may not be working"
    fi
fi

# ── Test 5: Lock file prevents concurrent runs ─────────────────────────────────────────────

echo ""
echo "=== Test 5: Lock file prevents concurrent runs ==="
if ! command -v flock >/dev/null 2>&1; then
    skip "Concurrent run lock test" "flock not available on this platform (Linux-only)"
else
    LOCK_FILE="/tmp/redstonecipher-backup-db.lock"
    rm -f "${LOCK_FILE}"
    # Acquire the lock in a subshell, then try to run the backup — it must exit with the lock error.
    LOCK_RESULT=0
    (
        exec 200>"${LOCK_FILE}"
        flock -n 200
        OUTPUT=$(DB_PATH="${TEST_DB}" BACKUP_DIR="${TEST_BACKUP_DIR}" SSH_KEY="/nonexistent" \
                 bash "${BACKUP_SCRIPT}" 2>&1 || true)
        if echo "${OUTPUT}" | grep -qi "Another backup is already running"; then
            echo "LOCK_PASS"
        else
            echo "LOCK_FAIL: ${OUTPUT}"
        fi
        flock -u 200
        rm -f "${LOCK_FILE}"
    ) > /tmp/lock_test_result.txt 2>&1 || LOCK_RESULT=$?
    LOCK_OUTPUT=$(cat /tmp/lock_test_result.txt 2>/dev/null || true)
    rm -f /tmp/lock_test_result.txt
    if echo "${LOCK_OUTPUT}" | grep -q "LOCK_PASS"; then
        pass "Concurrent run was rejected with expected lock error"
    else
        fail "Concurrent run was not blocked (got: ${LOCK_OUTPUT})"
    fi
fi

# ── Test 6: Missing database aborts cleanly ────────────────────────────────────

echo ""
echo "=== Test 6: Missing DB file causes clean exit with error ==="
OUTPUT=$(DB_PATH="/nonexistent/db.sqlite3" BACKUP_DIR="${TEST_BACKUP_DIR}" SSH_KEY="/nonexistent" \
         bash "${BACKUP_SCRIPT}" 2>&1 || true)
if echo "${OUTPUT}" | grep -qi "Database not found"; then
    pass "Missing DB produces expected error message"
else
    fail "Missing DB did not produce expected error (got: ${OUTPUT})"
fi

# ── Test 7: Missing SSH key skips offsite but succeeds locally ─────────────────

echo ""
echo "=== Test 7: Missing SSH key skips offsite copy without failing ==="
TEST_BACKUP_DIR2="${TMPDIR_ROOT}/backups2"
OUTPUT=$(DB_PATH="${TEST_DB}" BACKUP_DIR="${TEST_BACKUP_DIR2}" SSH_KEY="/nonexistent/key" \
         bash "${BACKUP_SCRIPT}" 2>&1)
if echo "${OUTPUT}" | grep -qi "offsite backup skipped" && \
   echo "${OUTPUT}" | grep -qi "Backup complete"; then
    pass "Offsite copy gracefully skipped when SSH key is absent"
else
    fail "Expected graceful skip of offsite copy (got: ${OUTPUT})"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════"
echo "  Results: ${PASS} passed  ${FAIL} failed  ${SKIP} skipped"
echo "════════════════════════════════════"
echo ""

[[ "${FAIL}" -eq 0 ]]

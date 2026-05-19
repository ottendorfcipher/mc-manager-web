#!/usr/bin/env bash
# scripts/backup-db.sh
#
# Daily backup of the redstoneCipher SQLite database.
#
# What it does:
#   1. Acquires a lock so concurrent runs cannot corrupt a backup in progress.
#   2. Creates a timestamped .sqlite3 copy in the local backup directory using
#      sqlite3's online ".backup" command (safe against concurrent WAL writes).
#   3. Prunes local backups older than RETENTION_DAYS (default 14).
#   4. Rsyncs the latest backup to mc-server-1 over Tailscale SSH so there is
#      at least one offsite copy.
#
# Install the cron:
#   0 3 * * * /opt/redstonecipher/scripts/backup-db.sh >> /var/log/redstonecipher-backup.log 2>&1
#
# Environment overrides (all have safe defaults):
#   DB_PATH           /opt/redstonecipher/data/mc-manager.db
#   BACKUP_DIR        /opt/redstonecipher/data/backups
#   RETENTION_DAYS    14
#   SSH_KEY           /opt/redstonecipher/mc_ssh_key
#   KNOWN_HOSTS       /opt/redstonecipher/mc_known_hosts
#   MC_HOST           root@100.123.253.30   (mc-server-1 Tailscale IP)
#   MC_BACKUP_DIR     /opt/minecraft/backups/db-snapshots

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

DB_PATH="${DB_PATH:-/opt/redstonecipher/data/mc-manager.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/redstonecipher/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SSH_KEY="${SSH_KEY:-/opt/redstonecipher/mc_ssh_key}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/opt/redstonecipher/mc_known_hosts}"
MC_HOST="${MC_HOST:-root@100.123.253.30}"
MC_BACKUP_DIR="${MC_BACKUP_DIR:-/opt/minecraft/backups/db-snapshots}"
LOCK_FILE="/tmp/redstonecipher-backup-db.lock"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="${BACKUP_DIR}/mc-manager-${TIMESTAMP}.sqlite3"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [backup-db] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ── Lock ──────────────────────────────────────────────────────────────────────

# flock is Linux-only; skip locking gracefully on other platforms (e.g. test runs on macOS).
if command -v flock >/dev/null 2>&1; then
    exec 200>"${LOCK_FILE}"
    if ! flock -n 200; then
        die "Another backup is already running (lock: ${LOCK_FILE}). Exiting."
    fi
    trap 'flock -u 200; rm -f "${LOCK_FILE}"' EXIT
else
    # Best-effort PID-file lock for platforms without flock.
    if [[ -f "${LOCK_FILE}" ]]; then
        EXISTING_PID=$(cat "${LOCK_FILE}" 2>/dev/null || true)
        if [[ -n "${EXISTING_PID}" ]] && kill -0 "${EXISTING_PID}" 2>/dev/null; then
            die "Another backup is already running (PID ${EXISTING_PID}). Exiting."
        fi
    fi
    echo $$ > "${LOCK_FILE}"
    trap 'rm -f "${LOCK_FILE}"' EXIT
fi

# ── Pre-flight checks ──────────────────────────────────────────────────────────

[[ -f "${DB_PATH}" ]] || die "Database not found: ${DB_PATH}"
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 not found in PATH"

mkdir -p "${BACKUP_DIR}" || die "Cannot create backup directory: ${BACKUP_DIR}"

# ── 1. Create backup (sqlite3 online backup — safe with WAL) ──────────────────

log "Starting backup: ${DB_PATH} → ${BACKUP_FILE}"

if ! sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"; then
    die "sqlite3 .backup failed"
fi

[[ -f "${BACKUP_FILE}" ]] || die "Backup file was not created: ${BACKUP_FILE}"

BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}")
log "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE} bytes)"

# Quick integrity check on the backup copy.
if ! sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" | grep -q "^ok$"; then
    log "WARNING: integrity_check on backup returned non-ok — backup may be corrupt"
fi

# ── 2. Prune local backups older than RETENTION_DAYS ─────────────────────────

log "Pruning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"
PRUNED=0
while IFS= read -r -d '' old_file; do
    rm -f "${old_file}"
    log "  Pruned: ${old_file}"
    PRUNED=$((PRUNED + 1))
done < <(find "${BACKUP_DIR}" -maxdepth 1 \
    -name "mc-manager-*.sqlite3" \
    -mtime +"${RETENTION_DAYS}" \
    -print0 2>/dev/null)
log "Pruned ${PRUNED} old backup(s)"

# ── 3. Offsite rsync to mc-server-1 ───────────────────────────────────────────

if [[ -f "${SSH_KEY}" ]]; then
    log "Rsyncing backup to ${MC_HOST}:${MC_BACKUP_DIR}"

    # Ensure the remote directory exists.
    ssh -i "${SSH_KEY}" \
        -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="${KNOWN_HOSTS}" \
        -o BatchMode=yes \
        -o ConnectTimeout=15 \
        "${MC_HOST}" \
        "mkdir -p '${MC_BACKUP_DIR}'" 2>/dev/null || {
            log "WARNING: Could not create remote backup dir (mc-server-1 may be offline) — offsite copy skipped"
            exit 0
        }

    if rsync -az \
        -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o BatchMode=yes -o ConnectTimeout=15" \
        "${BACKUP_FILE}" \
        "${MC_HOST}:${MC_BACKUP_DIR}/"; then
        log "Offsite copy uploaded: ${MC_HOST}:${MC_BACKUP_DIR}/$(basename "${BACKUP_FILE}")"
    else
        log "WARNING: rsync to mc-server-1 failed — local backup is intact, offsite copy missing"
        # Non-fatal: local backup succeeded; offsite failure shouldn't abort the job.
    fi

    # Prune remote copies older than RETENTION_DAYS too.
    ssh -i "${SSH_KEY}" \
        -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="${KNOWN_HOSTS}" \
        -o BatchMode=yes \
        -o ConnectTimeout=15 \
        "${MC_HOST}" \
        "find '${MC_BACKUP_DIR}' -maxdepth 1 -name 'mc-manager-*.sqlite3' -mtime +${RETENTION_DAYS} -delete" \
        2>/dev/null || true  # non-fatal

else
    log "WARNING: SSH key not found at ${SSH_KEY} — offsite backup skipped (local backup intact)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

log "Backup complete: ${BACKUP_FILE}"

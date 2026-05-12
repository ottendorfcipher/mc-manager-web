#!/bin/bash
# world-backup.sh — Create a backup for a specific world.
#
# Usage: world-backup.sh <world_slug>
#
# Output: prints the full remote path of the created .tar.gz on success.
# Backups are stored at /opt/minecraft/backups/<slug>/daily/<timestamp>.tar.gz
# Weekly promotion happens on Sundays; 7 daily + 4 weekly are retained.

set -euo pipefail

WORLD_SLUG="${1:-}"
if [[ -z "$WORLD_SLUG" ]]; then
    echo "ERROR: Usage: world-backup.sh <world_slug>" >&2
    exit 1
fi

RCON_PASS=$(cat /opt/minecraft/.rcon-password 2>/dev/null || echo "")
RCON_PORT=25575
SERVER_DIR=/opt/minecraft/server
BACKUP_BASE=/opt/minecraft/backups
BACKUP_DAILY="$BACKUP_BASE/$WORLD_SLUG/daily"
BACKUP_WEEKLY="$BACKUP_BASE/$WORLD_SLUG/weekly"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
BACKUP_PATH="$BACKUP_DAILY/$TIMESTAMP"
LOG=/opt/minecraft/backup.log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] BACKUP[$WORLD_SLUG]: $*" | tee -a "$LOG"; }

log "=== Starting backup at $TIMESTAMP ==="

mkdir -p "$BACKUP_PATH" "$BACKUP_WEEKLY"

# ── Pause saves if server is running ─────────────────────────────────────────
RCON_OK=false
if systemctl is-active --quiet minecraft && [[ -n "$RCON_PASS" ]]; then
    mcrcon -H 127.0.0.1 -P $RCON_PORT -p "$RCON_PASS" \
        "save-all flush" "save-off" 2>/dev/null || true
    log "  World saves paused via RCON"
    RCON_OK=true
fi

# ── Copy live world directories ───────────────────────────────────────────────
COPIED=0
for dir in world world_nether world_the_end; do
    if [[ -d "$SERVER_DIR/$dir" ]]; then
        rsync -a --delete "$SERVER_DIR/$dir/" "$BACKUP_PATH/$dir/"
        log "  Copied $dir"
        COPIED=$((COPIED + 1))
    fi
done

if [[ "$COPIED" -eq 0 ]]; then
    log "  WARNING: No world directories found in $SERVER_DIR — backup may be empty"
fi

# ── Re-enable saves ───────────────────────────────────────────────────────────
if [[ "$RCON_OK" == "true" ]]; then
    mcrcon -H 127.0.0.1 -P $RCON_PORT -p "$RCON_PASS" \
        "save-on" "save-all" 2>/dev/null || true
    log "  World saves re-enabled"
fi

# ── Compress ──────────────────────────────────────────────────────────────────
tar -czf "$BACKUP_PATH.tar.gz" -C "$BACKUP_DAILY" "$TIMESTAMP"
rm -rf "$BACKUP_PATH"
SIZE=$(du -sh "$BACKUP_PATH.tar.gz" | cut -f1)
log "  Compressed → $BACKUP_PATH.tar.gz ($SIZE)"

# ── Weekly promotion on Sundays ───────────────────────────────────────────────
if [[ "$(date +%u)" == "7" ]]; then
    cp "$BACKUP_PATH.tar.gz" "$BACKUP_WEEKLY/"
    log "  Promoted to weekly"
    # Keep 4 weeklies
    ls -t "$BACKUP_WEEKLY/"*.tar.gz 2>/dev/null | tail -n +5 | xargs rm -f || true
fi

# ── Prune: keep 7 daily ───────────────────────────────────────────────────────
ls -t "$BACKUP_DAILY/"*.tar.gz 2>/dev/null | tail -n +8 | xargs rm -f || true

log "=== Backup complete ==="
echo "$BACKUP_PATH.tar.gz"

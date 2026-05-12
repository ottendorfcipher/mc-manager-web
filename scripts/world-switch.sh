#!/bin/bash
# world-switch.sh — Safely switch the active Minecraft world.
#
# Usage: world-switch.sh <current_slug> <target_slug>
#
# Exit codes:
#   0 — succeeded (stdout ends with "DONE")
#   1 — failed    (stdout ends with "ERROR:<reason>")
#
# Safety guarantees:
#   • The server is stopped before any world files are moved.
#   • The current world is rsynced out to its storage directory BEFORE
#     the server world dirs are removed.
#   • If rsync of the current world fails, the script aborts and the world
#     files are left intact in the server directory.
#   • The DB active-world flag is only updated by the Rust backend AFTER
#     this script emits DONE, so a failure leaves the DB state consistent.

set -euo pipefail

CURRENT_SLUG="${1:-}"
TARGET_SLUG="${2:-}"

if [[ -z "$CURRENT_SLUG" || -z "$TARGET_SLUG" ]]; then
    echo "ERROR:missing_arguments"
    exit 1
fi

if [[ "$CURRENT_SLUG" == "$TARGET_SLUG" ]]; then
    # Nothing to do — already active
    echo "DONE"
    exit 0
fi

SERVER_DIR="/opt/minecraft/server"
WORLDS_DIR="/opt/minecraft/worlds"
LOG="/opt/minecraft/backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] WORLD-SWITCH: $*" | tee -a "$LOG"; }

log "=== Switching '$CURRENT_SLUG' → '$TARGET_SLUG' ==="

# ── 1. Stop the Minecraft service ─────────────────────────────────────────────
log "Stopping minecraft service..."
if systemctl is-active --quiet minecraft; then
    # Flush saves via RCON before stopping if possible
    RCON_PASS=$(cat /opt/minecraft/.rcon-password 2>/dev/null || true)
    if [[ -n "$RCON_PASS" ]]; then
        mcrcon -H 127.0.0.1 -P 25575 -p "$RCON_PASS" "save-all flush" 2>/dev/null || true
        log "  Flushed world saves"
        sleep 2
    fi
    systemctl stop minecraft
    sleep 3
fi
log "  Service stopped"

# ── 2. Save current world to its storage directory ────────────────────────────
log "Saving current world '$CURRENT_SLUG' to $WORLDS_DIR/$CURRENT_SLUG/ ..."
mkdir -p "$WORLDS_DIR/$CURRENT_SLUG"

SAVE_FAILED=false
for dir in world world_nether world_the_end; do
    if [[ -d "$SERVER_DIR/$dir" ]]; then
        if ! rsync -a --delete "$SERVER_DIR/$dir/" "$WORLDS_DIR/$CURRENT_SLUG/$dir/"; then
            log "  ERROR: rsync failed for $dir"
            SAVE_FAILED=true
            break
        fi
        log "  Saved $dir ($(du -sh "$SERVER_DIR/$dir" | cut -f1))"
    fi
done

if [[ "$SAVE_FAILED" == "true" ]]; then
    log "Aborting switch — current world save failed. Restarting server with original world."
    systemctl start minecraft || true
    echo "ERROR:save_failed"
    exit 1
fi
log "  Current world saved successfully"

# ── 3. Remove current world dirs from server ──────────────────────────────────
log "Removing current world from server directory..."
for dir in world world_nether world_the_end; do
    rm -rf "${SERVER_DIR:?}/$dir"
done

# ── 4. Load target world (or leave empty for fresh MC generation) ─────────────
log "Loading world '$TARGET_SLUG'..."
mkdir -p "$WORLDS_DIR/$TARGET_SLUG"

if [[ -d "$WORLDS_DIR/$TARGET_SLUG/world" ]]; then
    # Target world has been played before — restore it
    for dir in world world_nether world_the_end; do
        if [[ -d "$WORLDS_DIR/$TARGET_SLUG/$dir" ]]; then
            rsync -a "$WORLDS_DIR/$TARGET_SLUG/$dir/" "$SERVER_DIR/$dir/"
            log "  Loaded $dir"
        fi
    done
    log "  Restored existing world from storage"
else
    log "  No stored world found — Minecraft will generate a fresh world on first start"
fi

# Ensure backup directories exist for the new world
mkdir -p "/opt/minecraft/backups/$TARGET_SLUG/daily"
mkdir -p "/opt/minecraft/backups/$TARGET_SLUG/weekly"

# Fix ownership
chown -R minecraft:minecraft "$SERVER_DIR" || true
log "  Ownership fixed"

# ── 5. Start the Minecraft service ────────────────────────────────────────────
log "Starting minecraft service..."
systemctl start minecraft

# Wait up to 60 s for the service to become active
STARTED=false
for i in $(seq 1 60); do
    if systemctl is-active --quiet minecraft; then
        STARTED=true
        log "  Service active after ${i}s"
        break
    fi
    sleep 1
done

if [[ "$STARTED" != "true" ]]; then
    log "ERROR: Service failed to start after world switch"
    echo "ERROR:service_failed_to_start"
    exit 1
fi

log "=== Switch complete: '$CURRENT_SLUG' → '$TARGET_SLUG' ==="
echo "DONE"

#!/bin/bash
# mc-player-watchdog — enforces the Tailscale admission queue.
# Tails latest.log, calls redstonecipher.com on every join, kicks unapproved players.
# On allowed joins, applies the stored per-player gamemode via RCON.

BACKEND="https://redstonecipher.com"
TOKEN="***REMOVED-ROTATED-SECRET***"
LOG="/opt/minecraft/server/logs/latest.log"

get_rcon_pass() {
    grep '^rcon.password=' /opt/minecraft/server/server.properties | cut -d= -f2
}

kick_player() {
    local ign="$1" msg="$2"
    local pass; pass=$(get_rcon_pass)
    /usr/local/bin/mcrcon -H 127.0.0.1 -P 25575 -p "$pass" "kick $ign $msg" 2>/dev/null
}

apply_gamemode() {
    local ign="$1" gamemode="$2"
    # Only override if non-survival — survival is the server default, no command needed.
    [[ -z "$gamemode" || "$gamemode" == "survival" ]] && return
    local pass; pass=$(get_rcon_pass)
    /usr/local/bin/mcrcon -H 127.0.0.1 -P 25575 -p "$pass" "gamemode $gamemode $ign" 2>/dev/null
    logger -t mc-watchdog "GAMEMODE: $ign -> $gamemode"
}

logger -t mc-watchdog "Starting — watching $LOG"

tail -F "$LOG" 2>/dev/null | while IFS= read -r line; do
    # Match: [HH:MM:SS] [Server thread/INFO]: PlayerName joined the game
    if [[ "$line" =~ \]:[[:space:]](.+)[[:space:]]joined[[:space:]]the[[:space:]]game$ ]]; then
        IGN="${BASH_REMATCH[1]}"
        [[ -z "$IGN" ]] && continue
        # Reject if IGN contains spaces — Paper prepends team prefixes like
        # "Nick ChaoticLuc" when an alias is active. Real MC usernames are
        # [a-zA-Z0-9_]{3-16} with no spaces. Without this guard every alias
        # prefix + real-IGN pair creates a spurious pending-player entry.
        [[ "$IGN" =~ [[:space:]] ]] && continue
        # Reject IGNs longer than 16 chars (Mojang hard limit).
        (( ${#IGN} > 16 )) && continue

        RESPONSE=$(curl -sf -m 10 -X POST "$BACKEND/internal/player-joined" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"ign\":\"$IGN\"}" 2>/dev/null)

        ACTION=$(echo "$RESPONSE" | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
        GAMEMODE=$(echo "$RESPONSE" | grep -o '"gamemode":"[^"]*"' | cut -d'"' -f4)

        case "$ACTION" in
            allow)
                logger -t mc-watchdog "ALLOW: $IGN"
                # Restore per-player gamemode — give the server ~1 s to finish
                # loading the player before sending the command.
                if [[ -n "$GAMEMODE" && "$GAMEMODE" != "survival" ]]; then
                    sleep 1
                    apply_gamemode "$IGN" "$GAMEMODE"
                fi
                ;;
            kick)
                sleep 1
                kick_player "$IGN" "Your first visit has been logged. Ask a team member to approve you at redstonecipher.com"
                logger -t mc-watchdog "KICK (pending): $IGN"
                ;;
            ban)
                sleep 1
                kick_player "$IGN" "Your access has been denied."
                logger -t mc-watchdog "KICK (rejected): $IGN"
                ;;
            *)
                logger -t mc-watchdog "WARN: unknown action '$ACTION' for $IGN — allowing by default"
                ;;
        esac
    fi
done

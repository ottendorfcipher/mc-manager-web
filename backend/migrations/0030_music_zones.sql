-- Per-player music zones: when a player walks into a region, a sound is
-- played just for them.  Behavior options per zone:
--   * stop_on_leave        — stop the sound when player leaves the region
--                            (default: 0 — let the track play to completion)
--   * cooldown_secs        — minimum seconds after the track finishes before
--                            the same player can be retriggered
--                            (default: 1800 = 30 min)
--   * no retrigger while playing — always on; enforced by the runner state
--
-- target_players_json: JSON array of IGNs.  NULL means "all players".

CREATE TABLE IF NOT EXISTS music_zones (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    dimension           TEXT    NOT NULL DEFAULT 'minecraft:overworld',
    center_x            INTEGER NOT NULL,
    center_z            INTEGER NOT NULL,
    radius              INTEGER NOT NULL DEFAULT 32,
    -- Optional Y range. NULL/NULL = any height.
    min_y               INTEGER,
    max_y               INTEGER,
    -- JSON array of sound IDs played in sequence on trigger.
    sound_ids_json      TEXT    NOT NULL,
    -- JSON array of IGNs.  NULL = applies to every online player.
    target_players_json TEXT,
    stop_on_leave       INTEGER NOT NULL DEFAULT 0,
    cooldown_secs       INTEGER NOT NULL DEFAULT 1800,
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_by          TEXT    NOT NULL,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Per-zone-per-player runtime state.
--   in_zone        – were they inside the region at the last tick?
--   is_playing     – is the trigger currently in flight (sound still playing)?
--   sound_index    – which entry of sound_ids_json is currently playing
--   started_at     – wall-clock time of the most recent trigger
--   finished_at    – wall-clock time the last trigger completed (for cooldown)
CREATE TABLE IF NOT EXISTS music_zone_player_state (
    zone_id     INTEGER NOT NULL,
    player_ign  TEXT    NOT NULL,
    in_zone     INTEGER NOT NULL DEFAULT 0,
    is_playing  INTEGER NOT NULL DEFAULT 0,
    sound_index INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT,
    finished_at TEXT,
    PRIMARY KEY (zone_id, player_ign),
    FOREIGN KEY (zone_id) REFERENCES music_zones(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_zone_state_zone ON music_zone_player_state (zone_id);

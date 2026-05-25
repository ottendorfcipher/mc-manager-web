-- Replace cylinder zones (center+radius) with axis-aligned bounding boxes
-- defined by two corner points (x1,y1,z1) → (x2,y2,z2).

-- SQLite has limited ALTER TABLE, so recreate.
CREATE TABLE music_zones_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    dimension           TEXT    NOT NULL DEFAULT 'minecraft:overworld',
    x1                  INTEGER NOT NULL,
    y1                  INTEGER NOT NULL,
    z1                  INTEGER NOT NULL,
    x2                  INTEGER NOT NULL,
    y2                  INTEGER NOT NULL,
    z2                  INTEGER NOT NULL,
    sound_ids_json      TEXT    NOT NULL,
    target_players_json TEXT,
    stop_on_leave       INTEGER NOT NULL DEFAULT 0,
    cooldown_secs       INTEGER NOT NULL DEFAULT 1800,
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_by          TEXT    NOT NULL,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing cylinder zones → bounding boxes.
INSERT INTO music_zones_new
    (id, name, dimension, x1, y1, z1, x2, y2, z2,
     sound_ids_json, target_players_json, stop_on_leave,
     cooldown_secs, enabled, created_by, created_at)
SELECT id, name, dimension,
       center_x - radius, COALESCE(min_y, -64),  center_z - radius,
       center_x + radius, COALESCE(max_y, 320), center_z + radius,
       sound_ids_json, target_players_json, stop_on_leave,
       cooldown_secs, enabled, created_by, created_at
FROM music_zones;

DROP TABLE music_zones;
ALTER TABLE music_zones_new RENAME TO music_zones;

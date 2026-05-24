-- Rising Oceans event: gradual water-level rise in a region.
CREATE TABLE IF NOT EXISTS rising_oceans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    status          TEXT    NOT NULL DEFAULT 'pending',
    center_x        INTEGER NOT NULL DEFAULT 0,
    center_z        INTEGER NOT NULL DEFAULT 0,
    radius          INTEGER NOT NULL DEFAULT 256,
    start_y         INTEGER NOT NULL DEFAULT 64,
    end_y           INTEGER NOT NULL DEFAULT 100,
    current_y       INTEGER NOT NULL DEFAULT 64,
    interval_secs   INTEGER NOT NULL DEFAULT 30,
    backup_id       INTEGER,
    backup_path     TEXT,
    world_slug      TEXT    NOT NULL,
    created_by      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    started_at      TEXT,
    finished_at     TEXT,
    reverted        INTEGER
);

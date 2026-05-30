-- Bounty board system for competitive events.
CREATE TABLE IF NOT EXISTS bounty_boards (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    title                         TEXT    NOT NULL,
    status                        TEXT    NOT NULL DEFAULT 'pending',
    coord_broadcast_interval_secs INTEGER NOT NULL DEFAULT 300,
    coord_broadcast_threshold     INTEGER NOT NULL DEFAULT 10,
    reward_interval_secs          INTEGER NOT NULL DEFAULT 600,
    reward_items_json             TEXT    NOT NULL DEFAULT '["minecraft:diamond 3"]',
    rising_oceans_id              INTEGER,
    world_slug                    TEXT    NOT NULL,
    created_by                    TEXT    NOT NULL,
    created_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
    started_at                    TEXT,
    finished_at                   TEXT,
    FOREIGN KEY (rising_oceans_id) REFERENCES rising_oceans(id)
);

CREATE TABLE IF NOT EXISTS bounty_board_tracked_stats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL,
    stat_key   TEXT    NOT NULL,
    label      TEXT    NOT NULL,
    mc_paths   TEXT    NOT NULL,
    stat_mode  TEXT    NOT NULL DEFAULT 'delta',
    weight     REAL    NOT NULL DEFAULT 1.0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (board_id) REFERENCES bounty_boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bounty_board_baselines (
    board_id       INTEGER NOT NULL,
    player_uuid    TEXT    NOT NULL,
    player_ign     TEXT    NOT NULL,
    stat_key       TEXT    NOT NULL,
    baseline_value INTEGER NOT NULL DEFAULT 0,
    captured_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (board_id, player_uuid, stat_key),
    FOREIGN KEY (board_id) REFERENCES bounty_boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bounty_board_scores (
    board_id      INTEGER NOT NULL,
    player_uuid   TEXT    NOT NULL,
    player_ign    TEXT    NOT NULL,
    stat_key      TEXT    NOT NULL,
    raw_value     INTEGER NOT NULL DEFAULT 0,
    delta         INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (board_id, player_uuid, stat_key),
    FOREIGN KEY (board_id) REFERENCES bounty_boards(id) ON DELETE CASCADE
);

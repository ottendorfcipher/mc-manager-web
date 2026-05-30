-- Standalone scrolling credits sequences that can be triggered by music zones.
CREATE TABLE scrolling_credits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    lines_json      TEXT    NOT NULL DEFAULT '[]',
    scroll_speed_ms INTEGER NOT NULL DEFAULT 1500,
    freeze_player   INTEGER NOT NULL DEFAULT 1,
    created_by      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Let music zones optionally reference a credits sequence.
ALTER TABLE music_zones ADD COLUMN credits_id INTEGER
    REFERENCES scrolling_credits(id) ON DELETE SET NULL;

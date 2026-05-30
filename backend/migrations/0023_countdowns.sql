-- Countdown timers displayed in-game, managed from the Events tab.
CREATE TABLE IF NOT EXISTS countdowns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    duration_secs INTEGER NOT NULL,
    target        TEXT    NOT NULL DEFAULT '@a',
    display_mode  TEXT    NOT NULL DEFAULT 'actionbar,title_final',
    color         TEXT    NOT NULL DEFAULT 'yellow',
    sound_id      TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending',
    elapsed_secs  INTEGER NOT NULL DEFAULT 0,
    created_by    TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    finished_at   TEXT
);

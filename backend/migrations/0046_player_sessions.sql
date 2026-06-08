-- Player play-session tracking for activity insights.
-- One row per join; ended_at is set on the matching leave (NULL while online).
CREATE TABLE IF NOT EXISTS player_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ign        TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ended_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_ign     ON player_sessions (ign);
CREATE INDEX IF NOT EXISTS idx_player_sessions_started ON player_sessions (started_at);
-- Partial index to make "close the open session" fast.
CREATE INDEX IF NOT EXISTS idx_player_sessions_open    ON player_sessions (ign) WHERE ended_at IS NULL;

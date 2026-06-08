-- Per-user email notification preferences. A missing row means "all on".
CREATE TABLE IF NOT EXISTS user_notification_prefs (
    email          TEXT PRIMARY KEY,
    pending_player INTEGER NOT NULL DEFAULT 1,
    world_switch   INTEGER NOT NULL DEFAULT 1,
    kill_switch    INTEGER NOT NULL DEFAULT 1,
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Enable foreign key enforcement (must be set per-connection in SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    email        TEXT PRIMARY KEY,
    role         TEXT NOT NULL
                 CHECK(role IN ('global_admin','admin','member','user')),
    display_name TEXT NOT NULL,
    google_sub   TEXT UNIQUE,
    avatar_url   TEXT,
    added_by     TEXT NOT NULL,
    added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login   TEXT
);

-- The permanent global admin is seeded here so it survives a fresh DB
INSERT OR IGNORE INTO users (email, role, display_name, added_by)
VALUES ('nicholasaweiner@gmail.com', 'global_admin', 'Nicholas', 'system');

CREATE TABLE IF NOT EXISTS player_links (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    email     TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    ign       TEXT NOT NULL,
    gamemode  TEXT NOT NULL DEFAULT 'survival'
              CHECK(gamemode IN ('survival','creative','adventure','spectator')),
    linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(email, ign)
);

CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL UNIQUE,
    file_path  TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    notes      TEXT
);

CREATE TABLE installed_plugins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL UNIQUE,
    project_key   TEXT,
    declared_name TEXT,
    version       TEXT,
    api_version   TEXT,
    depends_json  TEXT NOT NULL DEFAULT '[]',
    softdepends_json TEXT NOT NULL DEFAULT '[]',
    sha1          TEXT,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    update_available INTEGER NOT NULL DEFAULT 0,
    installed_by  TEXT NOT NULL,
    installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_load_status TEXT NOT NULL DEFAULT 'unknown',
    last_status_at   TEXT
);

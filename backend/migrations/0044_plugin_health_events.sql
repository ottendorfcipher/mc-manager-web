CREATE TABLE plugin_health_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_filename TEXT,
    kind          TEXT NOT NULL,
    detail        TEXT NOT NULL,
    raw_line      TEXT,
    observed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_plugin_health_at ON plugin_health_events(observed_at DESC);

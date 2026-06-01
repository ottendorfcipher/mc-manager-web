CREATE TABLE plugin_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,
    project_key   TEXT,
    target_version TEXT,
    requested_by  TEXT NOT NULL,
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
    state         TEXT NOT NULL DEFAULT 'queued',
    state_detail  TEXT,
    plan_json     TEXT,
    backup_id     INTEGER REFERENCES backup_runs(id),
    audit_id      INTEGER,
    finished_at   TEXT
);

CREATE INDEX idx_plugin_jobs_state ON plugin_jobs(state);
CREATE INDEX idx_plugin_jobs_requested_at ON plugin_jobs(requested_at DESC);

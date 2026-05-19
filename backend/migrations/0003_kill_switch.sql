-- Single-row kill-switch. When disabled_at is non-null, all mutating API
-- endpoints return 503 Service Unavailable. Populated by the Pub/Sub budget
-- watcher or manually by a global admin.
CREATE TABLE IF NOT EXISTS kill_switch (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  disabled_at  TEXT,
  reason       TEXT,
  source       TEXT
);

-- Seed the single row so we can rely on UPDATE semantics later.
INSERT OR IGNORE INTO kill_switch (id, disabled_at, reason, source)
VALUES (1, NULL, NULL, NULL);

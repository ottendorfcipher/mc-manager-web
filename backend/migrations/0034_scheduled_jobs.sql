-- Scheduled (cron-style) automations.  Background runner ticks every minute,
-- fires every job whose `next_fire_at` has elapsed, then schedules the next
-- fire based on `cron_expr`.
--
-- action_type: 'console' | 'announce' | 'discord' | 'backup' | 'countdown'
-- action_payload: action-specific JSON
--    console   → {"command":"weather rain"}
--    announce  → {"text":"Server restarting in 5"}
--    discord   → {"message":"Hello from the bot"}
--    backup    → {"world_slug":"survival"}    (NULL = active world)
--    countdown → {"countdown_id":42}          (existing pending countdown)
--
-- A simple subset of cron is supported: "M H D M W" where each field is
--   *   ─ wildcard
--   N   ─ exact value
--   N,N ─ list
--   N/N ─ step (e.g. "*/15" = every 15 min)
-- Days-of-week: 0–6, Sunday=0.

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    cron_expr       TEXT    NOT NULL,
    action_type     TEXT    NOT NULL,
    action_payload  TEXT    NOT NULL DEFAULT '{}',
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_fire_at    TEXT,
    next_fire_at    TEXT,
    last_status     TEXT,   -- 'ok' | 'error: …' | NULL
    created_by      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next ON scheduled_jobs (next_fire_at);

-- Seed navigation + management permissions for the Automations tab.
INSERT OR IGNORE INTO permissions (key, category, description)
VALUES
  ('nav.automations',        'Navigation', 'See the Automations tab'),
  ('server.schedule.manage', 'Server',     'Create, edit, run, and delete scheduled jobs');

-- Grant both to global_admin and admin by default.
INSERT OR IGNORE INTO role_permissions (role, permission_key)
VALUES
  ('global_admin', 'nav.automations'),
  ('global_admin', 'server.schedule.manage'),
  ('admin',        'nav.automations'),
  ('admin',        'server.schedule.manage');

-- Migration 0017: Multi-world management
--
-- worlds        – named world slots; only one row has is_active = 1
-- world_members – portal users assigned to a world (organisational grouping)
-- backup_runs   – extended with nullable world_id / world_slug so per-world
--                 backups are tagged while legacy flat backups remain valid

-- ── 1. Worlds ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worlds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,   -- used as directory name on mc-server-1
    description TEXT,
    seed        TEXT,                      -- optional seed for brand-new worlds
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_by  TEXT    NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_worlds_active ON worlds (is_active);

-- ── 2. World members ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_members (
    world_id    INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    user_email  TEXT    NOT NULL,
    added_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (world_id, user_email)
);

-- ── 3. Tag existing backup_runs with world columns ─────────────────────────────
-- SQLite cannot add NOT NULL columns without defaults, so both are nullable.
-- Legacy rows stay with NULL; new per-world rows carry both values.

ALTER TABLE backup_runs ADD COLUMN world_id   INTEGER REFERENCES worlds(id) ON DELETE SET NULL;
ALTER TABLE backup_runs ADD COLUMN world_slug TEXT;

-- ── 4. Seed the default active world (the current live survival world) ──────────

INSERT OR IGNORE INTO worlds (name, slug, description, is_active, created_by)
VALUES ('Survival', 'survival', 'The main survival world', 1, 'system');

-- Back-fill existing backup rows with the survival world so they appear in the
-- world-specific backup list rather than as orphaned legacy entries.
UPDATE backup_runs
   SET world_id   = (SELECT id FROM worlds WHERE slug = 'survival'),
       world_slug = 'survival'
 WHERE world_id IS NULL;

-- ── 5. Permissions ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('worlds.view',           'worlds', 'View the worlds list and details'),
    ('worlds.create',         'worlds', 'Create new worlds'),
    ('worlds.switch',         'worlds', 'Switch the active world (restarts the MC service)'),
    ('worlds.delete',         'worlds', 'Delete a non-active world'),
    ('worlds.members.manage', 'worlds', 'Assign portal users to worlds'),
    ('worlds.backups.create', 'worlds', 'Create a backup scoped to a specific world'),
    ('nav.worlds',            'nav',    'Show the Worlds tab in Admin');

INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('admin',        'worlds.view'),
    ('admin',        'worlds.create'),
    ('admin',        'worlds.switch'),
    ('admin',        'worlds.delete'),
    ('admin',        'worlds.members.manage'),
    ('admin',        'worlds.backups.create'),
    ('admin',        'nav.worlds'),
    ('global_admin', 'worlds.view'),
    ('global_admin', 'worlds.create'),
    ('global_admin', 'worlds.switch'),
    ('global_admin', 'worlds.delete'),
    ('global_admin', 'worlds.members.manage'),
    ('global_admin', 'worlds.backups.create'),
    ('global_admin', 'nav.worlds');

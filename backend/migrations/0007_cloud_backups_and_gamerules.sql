-- Migration 0007: Cloud backups & gamerule persistence
--
-- 1. world_gamerules: cache gamerule values set through the UI so the
--    ServerPage can display the correct toggle state on load without
--    querying the Minecraft process.
-- 2. backup_runs: add storage_location and gcs_uri so each backup can
--    track whether it is stored locally, in GCS, or both.
-- 3. New permission key backups.create.cloud.

-- ── 1. Gamerule persistence ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS world_gamerules (
    rule       TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Seed with the six rules managed by the ServerPage UI, matching the
-- GAMERULES constant in the frontend (defaultOn values mapped to their
-- Minecraft truth strings).
INSERT OR IGNORE INTO world_gamerules (rule, value) VALUES
    ('reducedDebugInfo',    'false'),   -- defaultOn: true  → onVal 'false'
    ('keepInventory',       'false'),   -- defaultOn: false → offVal 'false'
    ('doFireTick',          'true'),    -- defaultOn: true  → onVal 'true'
    ('mobGriefing',         'true'),    -- defaultOn: true  → onVal 'true'
    ('doMobSpawning',       'true'),    -- defaultOn: true  → onVal 'true'
    ('announceAdvancements','true');    -- defaultOn: true  → onVal 'true'

-- ── 2. backup_runs: storage tier columns ────────────────────────────────────
-- SQLite does not support adding NOT NULL columns without a default to an
-- existing table, so we add with a DEFAULT and then the constraint is
-- enforced going forward by the application layer.
ALTER TABLE backup_runs ADD COLUMN storage_location TEXT NOT NULL DEFAULT 'local';
ALTER TABLE backup_runs ADD COLUMN gcs_uri          TEXT;

-- ── 3. New permission key ────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('backups.create.cloud', 'backups', 'Upload a backup archive to Google Cloud Storage');

-- Grant to global_admin and admin by default.
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('global_admin', 'backups.create.cloud'),
    ('admin',        'backups.create.cloud');

-- Migration 0008: Extended backup retention
--
-- Adds extended_retention flag to backup_runs so cloud backups can be
-- pinned to a 1-year lifecycle instead of the default 30-day auto-delete.
-- Matching GCS path prefixes:
--   Regular cloud : backups/regular/<filename>  → deleted after 30 days
--   Extended cloud: backups/extended/<filename> → deleted after 365 days

ALTER TABLE backup_runs ADD COLUMN extended_retention INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('backups.create.extended', 'backups', 'Create a cloud backup with 1-year retention instead of 30 days');

-- Grant to global_admin only by default (high-trust operation).
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('global_admin', 'backups.create.extended');

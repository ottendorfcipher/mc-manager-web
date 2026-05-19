-- Migration 0011: Unify backups as Hetzner-only
--
-- Backups now live exclusively on mc-server-1 at /opt/minecraft/backups/daily/.
-- The backend syncs metadata from there via SSH at startup and after each create.
-- GCS cloud upload is removed; the local/cloud distinction is gone.
--
-- 1. Remove the cloud-specific permissions so they don't clutter the catalog.
-- 2. Clear stale backup_runs rows (all pointed to the web-server's local disk).
--    They will be re-populated automatically at next service startup via SSH sync.
--
-- Note: SQLite cannot DROP columns, so storage_location / gcs_uri /
-- extended_retention stay in the schema but are ignored by the application.

-- ── 1. Remove cloud backup permissions ───────────────────────────────────────
DELETE FROM role_permissions
WHERE permission_key IN ('backups.create.cloud', 'backups.create.extended');

DELETE FROM permissions
WHERE key IN ('backups.create.cloud', 'backups.create.extended');

-- ── 2. Clear stale records (paths pointed to web-server disk, no longer valid) ─
DELETE FROM backup_runs;

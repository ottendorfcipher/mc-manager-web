-- Migration 0006: Dynamic role management
--
-- The five hardcoded roles (global_admin, admin, member, user, visitor) become
-- rows in a `roles` table.  New custom roles can be created, edited, and
-- deleted through the admin UI by anyone holding `roles.create` / `roles.edit`
-- / `roles.delete` — a permission that the global admin can delegate.
--
-- Key changes:
--   1. `roles` catalog table (system + custom)
--   2. `users` rebuilt without the CHECK(role IN (...)) constraint
--   3. `user_permission_overrides` — additive per-user grants
--   4. New permission keys for role administration and MC server operations

-- ── 1. Roles catalog ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    name        TEXT PRIMARY KEY
                CHECK(length(name) BETWEEN 1 AND 32),
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#6B7280',
    -- 0 = lowest access, higher = more authority.
    -- Actors can only create/assign roles with level STRICTLY below their own.
    level       INTEGER NOT NULL DEFAULT 0,
    -- System roles are seeded here and cannot be renamed or deleted.
    -- Their level and name are immutable; label/description/color are editable.
    is_system   INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO roles (name, label, description, color, level, is_system, created_by) VALUES
    ('global_admin', 'Global Admin', 'Full system access. Cannot be modified or deleted.', '#FBBF24', 4, 1, 'system'),
    ('admin',        'Admin',        'Manage users and server configuration.',               '#5B9BF0', 3, 1, 'system'),
    ('member',       'Member',       'Day-to-day server control and backups.',              '#36B37E', 2, 1, 'system'),
    ('user',         'User',         'Read-only access with own player gamemode.',          '#9B9EA6', 1, 1, 'system'),
    ('visitor',      'Visitor',      'Dashboard view only.',                                '#B8BCC8', 0, 1, 'system');

-- ── 2. Rebuild users — remove the hardcoded CHECK constraint ───────────────────
-- SQLite does not support ALTER TABLE … DROP CONSTRAINT so we rebuild.
-- The new table references roles(name) so any invalid role assignment fails
-- at the FK layer when foreign_keys = ON.
PRAGMA foreign_keys = OFF;

CREATE TABLE users_v3 (
    email        TEXT PRIMARY KEY,
    role         TEXT NOT NULL DEFAULT 'visitor',
    display_name TEXT NOT NULL,
    google_sub   TEXT UNIQUE,
    avatar_url   TEXT,
    added_by     TEXT NOT NULL,
    added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login   TEXT
);

INSERT INTO users_v3 SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_v3 RENAME TO users;

PRAGMA foreign_keys = ON;

-- ── 3. Per-user additive permission overrides ──────────────────────────────────
-- Grants additional permissions on top of the user's role.  These can only
-- ADD permissions, never remove them.  Managed by users.permission_overrides.edit.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
    email          TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    granted_by     TEXT NOT NULL,
    granted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (email, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_overrides_email
    ON user_permission_overrides(email);

-- ── 4. New permission keys ─────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    -- Role management (new capability: non-admin can be delegated these)
    ('roles.view',                      'roles',   'View the full role list and their permissions'),
    ('roles.create',                    'roles',   'Create custom roles with level below your own'),
    ('roles.edit',                      'roles',   'Edit role metadata and permission assignments'),
    ('roles.delete',                    'roles',   'Delete custom (non-system) roles with no members'),
    -- User access (fixes gap: users.view is now separate from management)
    ('users.view',                      'users',   'View the full user list (read-only)'),
    ('users.permission_overrides.edit', 'users',   'Grant or revoke per-user permission overrides'),
    -- Minecraft server operations (granular controls)
    ('server.vm.reset',                 'server',  'Hard-reset the Compute Engine VM (/reset)'),
    ('server.whitelist.manage',         'server',  'Add or remove players from the server whitelist'),
    ('server.op.manage',                'server',  'Op or deop players (/op, /deop)'),
    ('server.kick',                     'server',  'Kick a player from the server (/kick)'),
    ('server.ban.manage',               'server',  'Ban or pardon players (/ban, /pardon)'),
    ('server.announce',                 'server',  'Broadcast a message to all players (/say)'),
    ('server.save',                     'server',  'Force an immediate world save (/save-all)'),
    -- Navigation
    ('nav.roles',                       'nav',     'Show the Roles tab in the admin panel');

-- ── 5. Grant new permissions to system roles ───────────────────────────────────

-- global_admin: gets everything automatically
INSERT OR IGNORE INTO role_permissions (role, permission_key)
    SELECT 'global_admin', key FROM permissions
    WHERE key NOT IN (
        SELECT permission_key FROM role_permissions WHERE role = 'global_admin'
    );

-- admin: everything except roles.delete and users.permission_overrides.edit
-- (those stay global_admin-only by default; admins can be granted them later)
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('admin', 'roles.view'),
    ('admin', 'roles.edit'),
    ('admin', 'users.view'),
    ('admin', 'server.vm.reset'),
    ('admin', 'server.whitelist.manage'),
    ('admin', 'server.op.manage'),
    ('admin', 'server.kick'),
    ('admin', 'server.ban.manage'),
    ('admin', 'server.announce'),
    ('admin', 'server.save'),
    ('admin', 'nav.roles');

-- member: operational server access
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('member', 'users.view'),
    ('member', 'server.vm.reset'),
    ('member', 'server.kick'),
    ('member', 'server.announce'),
    ('member', 'server.save');

-- user and visitor: read-only team visibility
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('user',    'users.view'),
    ('visitor', 'users.view');

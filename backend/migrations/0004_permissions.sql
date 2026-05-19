-- Permission catalog and role->permission map.
-- Permissions are first-class string keys (e.g. "server.vm.start") so the
-- UI, API layer and middleware all speak the same vocabulary.

CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role           TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role, permission_key),
  FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE
);

-- ── Seed catalog ──────────────────────────────────────────────────────────────
-- Server / world control
INSERT INTO permissions (key, category, description) VALUES
  ('server.vm.start',         'server', 'Start the Compute Engine VM'),
  ('server.vm.stop',          'server', 'Stop the Compute Engine VM'),
  ('server.service.start',    'server', 'Start the Minecraft systemd service'),
  ('server.service.stop',     'server', 'Stop the Minecraft systemd service'),
  ('server.gamerule.set',     'server', 'Change a gamerule'),
  ('server.time.set',         'server', 'Set in-game time'),
  ('server.weather.set',      'server', 'Set weather'),
  ('server.console.write',    'server', 'Send console commands'),
  -- Backups
  ('backups.create',          'backups','Create a new world backup'),
  ('backups.restore',         'backups','Restore a backup'),
  ('backups.delete',          'backups','Delete a backup'),
  ('backups.download',        'backups','Download a backup archive'),
  -- server.properties
  ('config.read',             'config', 'Read server.properties'),
  ('config.write',            'config', 'Write server.properties'),
  -- Users & roles
  ('users.invite',            'users',  'Invite a new user'),
  ('users.remove',            'users',  'Remove an existing user'),
  ('users.role.change',       'users',  'Change a user''s role'),
  ('users.permissions.edit',  'users',  'Edit role-to-permission mappings'),
  -- Player linking
  ('players.link',            'players','Link a Minecraft IGN to a user'),
  ('players.unlink',          'players','Unlink an IGN'),
  ('players.gamemode',        'players','Change a linked player''s gamemode'),
  -- Kill-switch
  ('killswitch.view',         'admin',  'View kill-switch state'),
  ('killswitch.toggle',       'admin',  'Engage/release the kill-switch'),
  -- Navigation visibility
  ('nav.dashboard',           'nav',    'Show Dashboard in sidebar'),
  ('nav.server',              'nav',    'Show Server in sidebar'),
  ('nav.team',                'nav',    'Show Team in sidebar'),
  ('nav.backups',             'nav',    'Show Backups in sidebar'),
  ('nav.configure',           'nav',    'Show Configure in sidebar'),
  ('nav.admin',               'nav',    'Show Admin (permissions) in sidebar');

-- ── Seed role defaults ────────────────────────────────────────────────────────
-- global_admin: everything
INSERT INTO role_permissions (role, permission_key)
  SELECT 'global_admin', key FROM permissions;

-- admin: everything except the `users.permissions.edit` and killswitch controls
-- (those are global_admin-only by default, but admins may be granted later).
INSERT INTO role_permissions (role, permission_key)
  SELECT 'admin', key FROM permissions
  WHERE key NOT IN ('users.permissions.edit', 'killswitch.toggle', 'nav.admin');

-- member: control the server day-to-day but not manage users / config.
INSERT INTO role_permissions (role, permission_key) VALUES
  ('member', 'server.vm.start'),
  ('member', 'server.vm.stop'),
  ('member', 'server.service.start'),
  ('member', 'server.service.stop'),
  ('member', 'server.gamerule.set'),
  ('member', 'server.time.set'),
  ('member', 'server.weather.set'),
  ('member', 'server.console.write'),
  ('member', 'backups.create'),
  ('member', 'backups.download'),
  ('member', 'config.read'),
  ('member', 'players.gamemode'),
  ('member', 'killswitch.view'),
  ('member', 'nav.dashboard'),
  ('member', 'nav.server'),
  ('member', 'nav.team'),
  ('member', 'nav.backups'),
  ('member', 'nav.configure');

-- user: read-only view with their own linked player gamemode.
INSERT INTO role_permissions (role, permission_key) VALUES
  ('user', 'config.read'),
  ('user', 'backups.download'),
  ('user', 'players.gamemode'),
  ('user', 'killswitch.view'),
  ('user', 'nav.dashboard'),
  ('user', 'nav.server'),
  ('user', 'nav.team'),
  ('user', 'nav.backups');

-- visitor: dashboard only — a default for unverified invitees.
INSERT INTO role_permissions (role, permission_key) VALUES
  ('visitor', 'nav.dashboard'),
  ('visitor', 'killswitch.view');

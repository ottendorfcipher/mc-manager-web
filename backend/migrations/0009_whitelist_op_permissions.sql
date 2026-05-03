-- Migration 0009: add server.whitelist.manage and server.op.manage permissions
-- These gate the whitelist and op management endpoints in the Minecraft server.

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
  ('server.whitelist.manage', 'server', 'Add or remove players from the Minecraft whitelist'),
  ('server.op.manage',        'server', 'Op or de-op Minecraft players');

-- Grant both to global_admin and admin; members can whitelist but not op
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
  ('global_admin', 'server.whitelist.manage'),
  ('global_admin', 'server.op.manage'),
  ('admin',        'server.whitelist.manage'),
  ('admin',        'server.op.manage'),
  ('member',       'server.whitelist.manage');

-- Access-control pass: scope plugins, parties, and events; add member-level
-- read grants for the map (all player locations) and the dashboard event
-- status indicator. Idempotent (INSERT OR IGNORE / DELETE).

-- ── New permission keys ─────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (key, category, description) VALUES
  ('nav.plugins',               'nav',     'Show the Plugins tab (view installed plugins)'),
  ('plugins.manage',            'plugins', 'Install, update, upload, and remove plugins'),
  ('parties.manage',            'parties', 'Create, edit, delete parties and manage members'),
  ('players.location.view_all', 'players', 'See all player locations on the map'),
  ('events.status.view',        'events',  'See active/scheduled event status on the dashboard');

-- ── Grants ──────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
  -- Plugins: members and up can VIEW installed plugins; only admins manage.
  ('member',       'nav.plugins'),
  ('admin',        'nav.plugins'),
  ('global_admin', 'nav.plugins'),
  ('admin',        'plugins.manage'),
  ('global_admin', 'plugins.manage'),

  -- Parties: only admins create/delete/manage membership.
  ('admin',        'parties.manage'),
  ('global_admin', 'parties.manage'),

  -- Map: members and up can see all player locations (location-only feed).
  ('member',       'players.location.view_all'),
  ('admin',        'players.location.view_all'),
  ('global_admin', 'players.location.view_all'),

  -- Dashboard event status: members and up.
  ('member',       'events.status.view'),
  ('admin',        'events.status.view'),
  ('global_admin', 'events.status.view');

-- ── Events tab becomes admin-only ───────────────────────────────────────────
-- Revoke every Events permission from sub-admin roles. Admin/global_admin keep
-- theirs (seeded in 0038). The dashboard status indicator above is the only
-- Events visibility sub-admins now get.
DELETE FROM role_permissions
 WHERE role IN ('visitor', 'user', 'member')
   AND permission_key IN (
     'nav.events',
     'events.countdown.create',
     'events.countdown.manage',
     'events.rising_oceans.create',
     'events.rising_oceans.manage',
     'events.bounty_board.create',
     'events.bounty_board.manage',
     'events.lobby.manage'
   );

-- Belt-and-suspenders: ensure admin + global_admin retain the full Events set
-- (no-op if 0038 already granted them).
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
  ('admin',        'nav.events'),
  ('admin',        'events.countdown.create'),
  ('admin',        'events.countdown.manage'),
  ('admin',        'events.rising_oceans.create'),
  ('admin',        'events.rising_oceans.manage'),
  ('admin',        'events.bounty_board.create'),
  ('admin',        'events.bounty_board.manage'),
  ('admin',        'events.lobby.manage'),
  ('global_admin', 'nav.events'),
  ('global_admin', 'events.countdown.create'),
  ('global_admin', 'events.countdown.manage'),
  ('global_admin', 'events.rising_oceans.create'),
  ('global_admin', 'events.rising_oceans.manage'),
  ('global_admin', 'events.bounty_board.create'),
  ('global_admin', 'events.bounty_board.manage'),
  ('global_admin', 'events.lobby.manage');

-- Seed all Events feature permissions that were never added to the catalog.
-- Without these rows the "New lobby" button and other event controls are
-- invisible because no role can be granted the required permission keys.

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
  ('nav.events',                   'nav',    'Show the Events tab in the sidebar'),
  ('events.countdown.create',      'events', 'Create and start countdowns'),
  ('events.countdown.manage',      'events', 'Pause, resume, cancel, delete countdowns'),
  ('events.rising_oceans.create',  'events', 'Create rising-oceans events'),
  ('events.rising_oceans.manage',  'events', 'Start, pause, resume, revert rising-oceans events'),
  ('events.bounty_board.create',   'events', 'Create bounty boards'),
  ('events.bounty_board.manage',   'events', 'Manage bounty board lifecycle and entries'),
  ('events.lobby.manage',          'events', 'Create, launch, and close pre-game lobbies');

-- Grant all events permissions to global_admin, admin, and member roles.
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
  -- global_admin
  ('global_admin', 'nav.events'),
  ('global_admin', 'events.countdown.create'),
  ('global_admin', 'events.countdown.manage'),
  ('global_admin', 'events.rising_oceans.create'),
  ('global_admin', 'events.rising_oceans.manage'),
  ('global_admin', 'events.bounty_board.create'),
  ('global_admin', 'events.bounty_board.manage'),
  ('global_admin', 'events.lobby.manage'),
  -- admin
  ('admin', 'nav.events'),
  ('admin', 'events.countdown.create'),
  ('admin', 'events.countdown.manage'),
  ('admin', 'events.rising_oceans.create'),
  ('admin', 'events.rising_oceans.manage'),
  ('admin', 'events.bounty_board.create'),
  ('admin', 'events.bounty_board.manage'),
  ('admin', 'events.lobby.manage'),
  -- member (can create/view events but not manage others')
  ('member', 'nav.events'),
  ('member', 'events.countdown.create'),
  ('member', 'events.rising_oceans.create'),
  ('member', 'events.bounty_board.create');

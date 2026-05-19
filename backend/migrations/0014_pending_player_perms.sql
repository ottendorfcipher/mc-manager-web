-- Migration 0014: Permission keys for the Tailscale admission queue
--
-- Two new permissions gate the Pending Players admin tab:
--   players.pending.view   — see the queue of first-touch / unapproved IGNs
--   players.pending.manage — approve (link to a site user) or reject an IGN
--
-- Both are admin-tier only.  Members and below have no visibility into the
-- admission queue; that visibility could reveal IGNs of people who haven't
-- been approved yet.  global_admin inherits everything; admin gets both
-- because managing the queue is normal server-admin work.
-- visitor and user intentionally receive neither.

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('players.pending.view',   'players', 'View the pending Minecraft player admission queue'),
    ('players.pending.manage', 'players', 'Approve or reject players in the admission queue');

-- admin and global_admin: full access to the admission queue
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('admin',        'players.pending.view'),
    ('global_admin', 'players.pending.view'),
    ('admin',        'players.pending.manage'),
    ('global_admin', 'players.pending.manage');

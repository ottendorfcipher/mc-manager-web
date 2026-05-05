-- Migration 0016: nav.players permission for the Inventory page
--
-- Members can view their own linked player inventory; admins see all players
-- and have access to item gifting. user and visitor are excluded because they
-- cannot have linked IGNs and would see an empty page.

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('nav.players', 'nav', 'Show the Inventory item in the sidebar');

INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('member',       'nav.players'),
    ('admin',        'nav.players'),
    ('global_admin', 'nav.players');

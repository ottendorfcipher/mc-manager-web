-- Migration 0013: Map pins and new permission keys
--
-- map_pins: user-placed notes/markers visible on the BlueMap world map.
-- visibility: 'private' = only the author; 'team' = all authenticated users.

CREATE TABLE IF NOT EXISTS map_pins (
    id          INTEGER PRIMARY KEY,
    x           REAL    NOT NULL,
    z           REAL    NOT NULL,
    dimension   TEXT    NOT NULL DEFAULT 'minecraft:overworld',
    label       TEXT    NOT NULL,
    body        TEXT,
    icon        TEXT    NOT NULL DEFAULT 'default',
    visibility  TEXT    NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private', 'team')),
    created_by  TEXT    NOT NULL,   -- user email
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── New permissions ───────────────────────────────────────────────────────────

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('nav.map',            'nav',     'Show the Map item in the sidebar'),
    ('players.view_any',   'players', 'View any player location and inventory snapshot'),
    ('players.give_items', 'players', 'Give items to a player (online or offline)'),
    ('map.pin.create',     'map',     'Create location notes/pins on the world map'),
    ('map.pin.manage',     'map',     'Edit or delete any map pin');

-- Grant nav.map to everyone except visitor
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('user',         'nav.map'),
    ('member',       'nav.map'),
    ('admin',        'nav.map'),
    ('global_admin', 'nav.map');

-- Admin and global_admin: view/give
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('admin',        'players.view_any'),
    ('global_admin', 'players.view_any'),
    ('admin',        'players.give_items'),
    ('global_admin', 'players.give_items');

-- Members and above: create pins
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('member',       'map.pin.create'),
    ('admin',        'map.pin.create'),
    ('global_admin', 'map.pin.create');

-- Admin and above: manage all pins
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('admin',        'map.pin.manage'),
    ('global_admin', 'map.pin.manage');

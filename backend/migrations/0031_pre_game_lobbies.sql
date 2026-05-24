-- Pre-game lobbies: a holding pen in a dedicated dimension where players
-- wait before an event launches.  When the admin clicks "Launch", every
-- attendee is TP'd into the event area.  When the event ends, they're
-- TP'd back to where they were before joining the lobby.
--
-- linked_event_type: 'countdown' | 'rising_oceans' | 'bounty_board' | 'manual'
-- linked_event_id  : foreign-key into the matching events table.  NULL when
--                    linked_event_type = 'manual' (admin launches by hand).
-- launch_x/y/z     : coordinates in the LINKED-EVENT dimension where
--                    attendees materialise on launch (so the lobby can drop
--                    them at the arena spawn, not the world spawn).
-- launch_dimension : dimension ID for the launch destination, e.g.
--                    "minecraft:overworld" or "redstonecipher:arena".

CREATE TABLE IF NOT EXISTS pre_game_lobbies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    -- Spawn point inside the lobby dimension itself.
    lobby_x             INTEGER NOT NULL DEFAULT 0,
    lobby_y             INTEGER NOT NULL DEFAULT 66,
    lobby_z             INTEGER NOT NULL DEFAULT 0,
    radius              INTEGER NOT NULL DEFAULT 32,
    max_players         INTEGER NOT NULL DEFAULT 16,
    -- JSON array of IGNs.  NULL = open to everyone.
    allowed_players_json TEXT,
    -- What event launches when "Launch" is clicked.
    linked_event_type   TEXT    NOT NULL DEFAULT 'manual',
    linked_event_id     INTEGER,
    -- Where attendees materialise on launch.
    launch_dimension    TEXT    NOT NULL DEFAULT 'minecraft:overworld',
    launch_x            INTEGER NOT NULL DEFAULT 0,
    launch_y            INTEGER NOT NULL DEFAULT 70,
    launch_z            INTEGER NOT NULL DEFAULT 0,
    -- pending|open|locked|launching|launched|closed
    status              TEXT    NOT NULL DEFAULT 'pending',
    created_by          TEXT    NOT NULL,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    launched_at         TEXT,
    closed_at           TEXT
);

-- One row per player currently (or recently) inside a lobby.
-- pre_event_* columns hold the player's location at the moment they
-- joined the lobby, so we can teleport them back on close.
CREATE TABLE IF NOT EXISTS lobby_attendees (
    lobby_id            INTEGER NOT NULL,
    player_ign          TEXT    NOT NULL,
    joined_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    pre_event_dimension TEXT,
    pre_event_x         REAL,
    pre_event_y         REAL,
    pre_event_z         REAL,
    -- joined | launched | returned
    status              TEXT    NOT NULL DEFAULT 'joined',
    PRIMARY KEY (lobby_id, player_ign),
    FOREIGN KEY (lobby_id) REFERENCES pre_game_lobbies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lobby_attendees_lobby ON lobby_attendees (lobby_id);

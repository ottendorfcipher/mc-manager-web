-- Parties: named groups of in-game players used as a single targeting unit
-- across the app (countdowns, music zones, lobbies, pin HUD sharing, etc).
--
-- A party is owned by one user (their email).  Members are stored by IGN
-- (not user account) so a user with multiple linked accounts can add only
-- the specific characters they want in the party.

CREATE TABLE IF NOT EXISTS parties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT,
    owner_email TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT 'aqua',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner_email, name)
);

CREATE TABLE IF NOT EXISTS party_members (
    party_id   INTEGER NOT NULL,
    player_ign TEXT    NOT NULL,
    added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (party_id, player_ign),
    FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_party_members_party ON party_members (party_id);
CREATE INDEX IF NOT EXISTS idx_parties_owner       ON parties (owner_email);

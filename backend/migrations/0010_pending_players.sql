-- Players who connected over Tailscale but are not yet linked to a site user.
-- The watchdog inserts here on first join; admins approve or reject via the site.
CREATE TABLE IF NOT EXISTS pending_players (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ign             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    uuid            TEXT,
    first_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_attempted  TEXT    NOT NULL DEFAULT (datetime('now')),
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    -- pending | approved | rejected
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'approved', 'rejected'))
);

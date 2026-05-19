-- Allow the 'visitor' role in the users table.
-- The permissions catalog already seeds visitor permissions (migration 0004)
-- but the CHECK constraint on users.role only covered 4 roles.  SQLite does
-- not support ALTER TABLE … MODIFY COLUMN, so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
    email        TEXT PRIMARY KEY,
    role         TEXT NOT NULL
                 CHECK(role IN ('global_admin','admin','member','user','visitor')),
    display_name TEXT NOT NULL,
    google_sub   TEXT UNIQUE,
    avatar_url   TEXT,
    added_by     TEXT NOT NULL,
    added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login   TEXT
);

INSERT INTO users_new SELECT * FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Restore foreign-key references (player_links, audit_log reference users.email
-- via ON DELETE CASCADE which is re-established automatically on the new table).

PRAGMA foreign_keys = ON;

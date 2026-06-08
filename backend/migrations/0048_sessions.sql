-- Session management: "sign out everywhere" + login history.

-- Tokens issued (iat) strictly before this epoch-seconds value are rejected by
-- the auth middleware. 0 = no global revocation in effect.
ALTER TABLE users ADD COLUMN tokens_valid_after INTEGER NOT NULL DEFAULT 0;

-- One row per successful OAuth sign-in (for the "recent sign-ins" view).
CREATE TABLE IF NOT EXISTS login_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_login_events_email ON login_events (email, created_at DESC);

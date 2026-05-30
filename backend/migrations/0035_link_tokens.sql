-- One-time sign-in tokens for in-game QR code / clickable book links.
-- Each token is tied to a player IGN and the user's email address.
-- Tokens expire after 10 minutes and can only be used once.

CREATE TABLE IF NOT EXISTS link_tokens (
    token      TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    ign        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_link_tokens_expires ON link_tokens (expires_at);

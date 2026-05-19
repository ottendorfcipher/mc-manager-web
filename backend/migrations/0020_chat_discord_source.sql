-- Migration 0020: Add 'discord' to the chat_messages source enum.
--
-- The Discord ↔ Web ↔ Minecraft bridge (feat/discord) writes rows with
-- source='discord' for inbound messages from the bot gateway.  The original
-- 0015_chat.sql CHECK constraint only covered ('mc', 'web', 'server'), so
-- this migration recreates the table to include 'discord'.
--
-- SQLite does not support ALTER TABLE … MODIFY COLUMN, so we use the
-- standard rename-create-copy-drop pattern.

PRAGMA foreign_keys = OFF;

CREATE TABLE chat_messages_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT    NOT NULL CHECK (source IN ('mc', 'web', 'server', 'discord')),
    author      TEXT    NOT NULL,
    display_as  TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    sent_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO chat_messages_new SELECT * FROM chat_messages;

DROP TABLE chat_messages;

ALTER TABLE chat_messages_new RENAME TO chat_messages;

CREATE INDEX IF NOT EXISTS idx_chat_sent_at ON chat_messages (sent_at DESC);

PRAGMA foreign_keys = ON;

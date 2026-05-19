-- Migration 0015: Web ↔ Minecraft bi-directional chat
--
-- chat_messages stores the persistent history (broadcast messages only;
-- DMs are never written here since they are private).
--
-- source   'mc'     → originated in-game
--          'web'    → sent from the web dashboard
--          'server' → join/leave/other server events
--
-- author      raw identifier (email for web, IGN for mc/server)
-- display_as  human-readable label shown in the UI
-- content     the message text

CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT    NOT NULL CHECK (source IN ('mc', 'web', 'server')),
    author      TEXT    NOT NULL,
    display_as  TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    sent_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sent_at ON chat_messages (sent_at DESC);

-- ── Permission keys ───────────────────────────────────────────────────────────

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('chat.read', 'chat', 'View the in-game / web chat feed'),
    ('chat.send', 'chat', 'Send messages to the Minecraft server from the web'),
    ('nav.chat',  'nav',  'Show the Chat item in the sidebar');

-- member, admin, global_admin all get full chat access.
-- user and visitor are excluded (read-only site users / pending invitees).
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('member',       'chat.read'),
    ('member',       'chat.send'),
    ('member',       'nav.chat'),
    ('admin',        'chat.read'),
    ('admin',        'chat.send'),
    ('admin',        'nav.chat'),
    ('global_admin', 'chat.read'),
    ('global_admin', 'chat.send'),
    ('global_admin', 'nav.chat');

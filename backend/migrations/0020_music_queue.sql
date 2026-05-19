-- Migration 0020: Music queue — play vanilla Minecraft sounds for all players from the web.
--
-- Uses /playsound and /stopsound console commands; no client mods required.
-- sound_id     Minecraft namespaced sound event (e.g. "minecraft:music_disc.cat")
-- display_name Human-readable track name shown in the UI
-- requested_by Email of the web user who queued the track

CREATE TABLE IF NOT EXISTS music_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sound_id     TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    requested_by TEXT    NOT NULL,
    queued_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Permission keys ────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO permissions (key, category, description) VALUES
    ('music.play', 'music', 'Queue music tracks to play for everyone on the server'),
    ('nav.music',  'nav',   'Show the Music item in the sidebar');

-- member, admin, global_admin all get music access.
-- user and visitor are excluded.
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES
    ('member',       'music.play'),
    ('member',       'nav.music'),
    ('admin',        'music.play'),
    ('admin',        'nav.music'),
    ('global_admin', 'music.play'),
    ('global_admin', 'nav.music');

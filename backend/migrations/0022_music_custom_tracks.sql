-- Migration 0022: Custom music tracks via resource pack.
--
-- Allows server operators to register custom sound events from a server-pushed
-- resource pack so they appear in the web music catalog.  The sound_id must
-- match the event defined in the pack's assets/*/sounds.json, e.g.
-- "redstonecipher:custom.my_track".
--
-- The resource pack itself is uploaded separately and served as a static file
-- at /opt/redstonecipher/www/resource-pack.zip.

CREATE TABLE IF NOT EXISTS music_custom_tracks (
    sound_id      TEXT    PRIMARY KEY,          -- e.g. "redstonecipher:custom.my_track"
    display_name  TEXT    NOT NULL,
    artist        TEXT    NOT NULL DEFAULT '',
    duration_secs INTEGER NOT NULL DEFAULT 180,
    added_by      TEXT    NOT NULL,
    added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

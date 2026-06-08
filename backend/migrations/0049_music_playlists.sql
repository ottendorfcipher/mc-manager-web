-- Curated music playlists + play history.

CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    created_by TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id  INTEGER NOT NULL,
    sound_id     TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (playlist_id, sound_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pl ON playlist_tracks (playlist_id, position);

CREATE TABLE IF NOT EXISTS play_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sound_id     TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    played_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_play_history_time ON play_history (played_at DESC);

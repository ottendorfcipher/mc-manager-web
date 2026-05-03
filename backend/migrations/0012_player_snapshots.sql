-- Migration 0012: Player snapshots
--
-- Stores the most recent known position, inventory, and health for each
-- Minecraft player. One row per IGN, upserted on every refresh.
-- Refresh is triggered by the backend (RCON save-all flush → SSH → Python extractor).

CREATE TABLE IF NOT EXISTS player_snapshots (
    id            INTEGER PRIMARY KEY,
    uuid          TEXT    NOT NULL,
    ign           TEXT    NOT NULL UNIQUE,
    x             REAL    NOT NULL DEFAULT 0,
    y             REAL    NOT NULL DEFAULT 64,
    z             REAL    NOT NULL DEFAULT 0,
    yaw           REAL    NOT NULL DEFAULT 0,
    dimension     TEXT    NOT NULL DEFAULT 'minecraft:overworld',
    inventory_json TEXT   NOT NULL DEFAULT '[]',
    health        REAL    NOT NULL DEFAULT 20,
    captured_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

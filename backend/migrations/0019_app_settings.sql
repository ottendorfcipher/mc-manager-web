-- Encrypted key-value store for sensitive runtime settings.
-- Values are stored AES-256-GCM encrypted; the raw secret never leaves the process.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT NOT NULL PRIMARY KEY,
    value_enc  TEXT NOT NULL,          -- "<hex-nonce>:<hex-ciphertext>"
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_by TEXT NOT NULL           -- email of the admin who last changed this
);

-- Permission: configure the Discord integration.
-- Seeded to global_admin only; cannot be delegated to lower roles.
INSERT OR IGNORE INTO permissions (key, category, description)
VALUES (
    'discord.configure',
    'integrations',
    'View and update Discord bot token, webhook URL, and channel ID.'
);

INSERT OR IGNORE INTO role_permissions (role, permission_key)
VALUES ('global_admin', 'discord.configure');

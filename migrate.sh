#!/usr/bin/env bash
# migrate.sh - One-shot migration from the Python app's ~/.mc-manager/ to SQLite.
# Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING).
set -euo pipefail

USERS_JSON="$HOME/.mc-manager/users.json"
PREFS_JSON="$HOME/.mc-manager/prefs.json"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Desktop/minecraft server/backups}"
DB_PATH="${DATABASE_URL:-/Users/nicholasweiner/Desktop/mc-manager-web/mc-manager.db}"
DB_PATH="${DB_PATH#sqlite://}"

if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 is not installed. Install it with: brew install sqlite3"
  exit 1
fi

echo "Migrating to SQLite at: $DB_PATH"

# -- Users ----------------------------------------------------------------------
if [[ -f "$USERS_JSON" ]]; then
  echo "  Importing users from $USERS_JSON..."
  python3 - "$USERS_JSON" "$DB_PATH" <<'PYEOF'
import json, sqlite3, sys

with open(sys.argv[1]) as f:
    data = json.load(f)

users = data.get("users", {})
db = sqlite3.connect(sys.argv[2])
db.execute("PRAGMA foreign_keys = ON")

for email, rec in users.items():
    role     = rec.get("role", "user")
    name     = rec.get("display_name", email.split("@")[0])
    added_by = rec.get("added_by", "system")
    added_at = rec.get("added_at", "2026-01-01T00:00:00Z")

    db.execute(
        """INSERT INTO users (email, role, display_name, added_by, added_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET role = excluded.role, display_name = excluded.display_name""",
        (email, role, name, added_by, added_at)
    )

    for ign in rec.get("minecraft_players", []):
        gm = rec.get("player_gamemodes", {}).get(ign, "survival")
        db.execute(
            "INSERT OR IGNORE INTO player_links (email, ign, gamemode) VALUES (?, ?, ?)",
            (email, ign, gm)
        )

db.commit()
db.close()
print(f"  Imported {len(users)} user(s)")
PYEOF
fi

# -- Preferences ----------------------------------------------------------------
if [[ -f "$PREFS_JSON" ]]; then
  echo "  Importing preferences from $PREFS_JSON..."
  python3 - "$PREFS_JSON" "$DB_PATH" <<'PYEOF'
import json, sqlite3, sys

with open(sys.argv[1]) as f:
    prefs = json.load(f)

db = sqlite3.connect(sys.argv[2])
for key, value in prefs.items():
    db.execute(
        "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value))
    )
db.commit()
db.close()
print(f"  Imported {len(prefs)} preference(s)")
PYEOF
fi

# -- Backup metadata ------------------------------------------------------------
if [[ -d "$BACKUP_DIR" ]]; then
  echo "  Scanning backup directory: $BACKUP_DIR"
  python3 - "$BACKUP_DIR" "$DB_PATH" <<'PYEOF'
import os, sqlite3, glob, sys

backup_dir = sys.argv[1]
db = sqlite3.connect(sys.argv[2])
count = 0

for path in sorted(glob.glob(os.path.join(backup_dir, "mc-world-*.tar.gz"))):
    filename = os.path.basename(path)
    size     = os.path.getsize(path)
    existing = db.execute("SELECT id FROM backup_runs WHERE filename = ?", (filename,)).fetchone()
    if not existing:
        db.execute(
            "INSERT INTO backup_runs (filename, file_path, size_bytes, created_by) VALUES (?, ?, ?, ?)",
            (filename, path, size, "system")
        )
        count += 1

db.commit()
db.close()
print(f"  Registered {count} new backup file(s)")
PYEOF
fi

# Mark migration complete
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO preferences (key, value) VALUES ('migration_v1_done', 'true')"
echo "Migration complete."

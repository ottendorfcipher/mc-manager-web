# redstoneCipher — Deployment Reference

Last updated: 2026-05-20

> **Migration note**: This project was migrated from Google Cloud (Firebase Hosting +
> Cloud Run + GCE) to Hetzner-hosted bare servers in May 2026. All GCP projects
> (`redstonecipher-web`, `minecraft-493201`, `g-bridges`) are decommissioned.

## Architecture

```
                        Internet
                            │
                   ┌────────▼────────┐
                   │  Web Server      │  178.105.43.199
                   │  Hetzner (38 GB) │  redstonecipher.com
                   │  nginx + Rust    │
                   └────────┬────────┘
                            │ Tailscale (WireGuard)
                   ┌────────▼────────┐
                   │  MC Server       │  5.161.212.29
                   │  Hetzner (75 GB) │  Tailscale: 100.123.253.30
                   │  PaperMC 1.21.11 │
                   └─────────────────┘
```

All Minecraft traffic is private — port 25565 is **not** open to the public internet.
The web server reaches the MC server over Tailscale SSH.

---

## Servers

### Web server — `178.105.43.199`

| Property | Value |
|---|---|
| Provider | Hetzner |
| Tailscale IP | `100.67.225.12` |
| Disk | 38 GB total / 4.1 GB used |
| Domain | `redstonecipher.com`, `www.redstonecipher.com` |
| SSL | Let's Encrypt — expires **2026-08-01** (auto-renews via certbot) |

**Services**

| Service | State | Uptime |
|---|---|---|
| `nginx` | active | 1 hr 13 min |
| `redstonecipher` | active | 1 hr |

**Key paths**

| Path | Purpose |
|---|---|
| `/opt/redstonecipher/redstonecipher-server` | Rust backend binary |
| `/opt/redstonecipher/.env` | Environment / secrets |
| `/opt/redstonecipher/www/` | Built React frontend (static files) |
| `/etc/nginx/sites-enabled/redstonecipher` | nginx vhost config |
| `/etc/letsencrypt/live/redstonecipher.com/` | TLS certificates |

**nginx routing**

| Path pattern | Target |
|---|---|
| `/api/*`, `/auth/*` | `http://127.0.0.1:8080` (Rust backend) |
| `/*` | `/opt/redstonecipher/www` (SPA, `try_files … /index.html`) |
| HTTP → HTTPS | 301 redirect (managed by Certbot) |

---

### MC server — `5.161.212.29`

| Property | Value |
|---|---|
| Provider | Hetzner |
| Tailscale IP | `100.123.253.30` |
| Disk | 75 GB total / 7.4 GB used |
| Java | OpenJDK 21.0.11 |
| Server software | PaperMC 1.21.11 |
| Game port | `25565` (Tailscale interface only) |
| RCON | `127.0.0.1:25575` (localhost only) |
| World size | 82 MB |

**Services**

| Service | State | Uptime |
|---|---|---|
| `minecraft` | active | 35 min |
| `mc-fifo-bridge` | active | 35 min |

**Key paths**

| Path | Purpose |
|---|---|
| `/opt/minecraft/server/` | Active world root (always the running world) |
| `/opt/minecraft/server/world/` | Active overworld data |
| `/opt/minecraft/server/world_nether/` | Active nether data |
| `/opt/minecraft/server/world_the_end/` | Active end data |
| `/opt/minecraft/server/server.properties` | Server configuration |
| `/opt/minecraft/server/whitelist.json` | Whitelist entries |
| `/opt/minecraft/server/ops.json` | Operator list |
| `/opt/minecraft/server/logs/latest.log` | Live server log |
| `/opt/minecraft/console.fifo` | FIFO for RCON command bridge |
| `/opt/minecraft/worlds/` | **Inactive world storage** — one subdir per world slug |
| `/opt/minecraft/worlds/{slug}/` | Stored inactive world (`world/`, `world_nether/`, `world_the_end/`) |
| `/opt/minecraft/backups/` | Backup root |
| `/opt/minecraft/backups/{slug}/daily/` | Per-world daily backups (7 retained) |
| `/opt/minecraft/backups/{slug}/weekly/` | Per-world weekly backups (4 retained) |
| `/opt/minecraft/backups/daily/` | Legacy flat backups (pre-world-management) |
| `/opt/minecraft/scripts/world-switch.sh` | World-switch script (see World Management) |
| `/opt/minecraft/scripts/world-backup.sh` | Per-world backup script |
| `/usr/local/bin/mcrcon` | RCON client |

**Backup**

| Property | Value |
|---|---|
| Schedule | Daily at **04:00 UTC** (systemd timer: `minecraft-backup.timer`) |
| Timer state | Persistent (catches up missed runs) |
| Storage | `/opt/minecraft/backups/{world_slug}/daily/` per world |
| Retention | 7 daily + 4 weekly per world |
| Legacy path | `/opt/minecraft/backups/daily/` (pre-migration backups, still accessible) |

---

## Firewall (mc-server UFW)

| Rule | Action |
|---|---|
| `22/tcp` (SSH) | ALLOW IN |
| `41641/udp` (Tailscale WireGuard) | ALLOW IN |
| All traffic on `tailscale0` | ALLOW IN / OUT |
| Everything else | DENY (default) |

Minecraft port 25565 is intentionally absent from the public ruleset.
Access to the server requires being on the Tailscale network.

---

## Whitelist

Whitelist enforcement is **enabled** (`white-list=true`, `enforce-whitelist=true`).
`enforce-whitelist=true` takes full effect after the next server restart —
players already online will be kicked if removed from the whitelist mid-session.

> **The whitelist is currently empty.** No players can connect until you add them.

Add a player (requires a valid Mojang/Microsoft account username):

```bash
ssh mc-server
RCON_PASS=$(grep '^rcon.password=' /opt/minecraft/server/server.properties | cut -d= -f2)
/usr/local/bin/mcrcon -H 127.0.0.1 -P 25575 -p "$RCON_PASS" 'whitelist add <username>'
```

Or via the web console at **https://redstonecipher.com** → Server → Whitelist.

---

## Auth & Permissions

**Authentication**: Google OAuth, invite-only.

| Role | Level | Description |
|---|---|---|
| `global_admin` | 4 | Permanent seed account — `nicholasaweiner@gmail.com` |
| `admin` | 3 | Full management, cannot elevate to global_admin |
| `member` | 2 | Standard access |
| `user` | 1 | Limited access |
| `visitor` | 0 | Read-only |

- System roles cannot be deleted or have their level changed.
- Custom roles can be created via the admin UI with a level strictly below the creator's.
- Per-user permission overrides are additive (grant extra permissions beyond the role).
- Permissions are re-checked from the DB on every request — changes take effect immediately without requiring re-login.
- Any Google account not in the users table (and not the `global_admin` email) is rejected at the OAuth callback with `?error=not_invited`.

**JWT**: HS256, 8-hour expiry, stored in `__session` cookie (HttpOnly, Secure, SameSite=Lax).

---

## Common Runbooks

### Restart the Minecraft server

```bash
ssh mc-server 'systemctl restart minecraft'
```

### Deploy a new backend build

> The web server is x86_64 Linux — always build natively on the server.

```bash
# 1. Sync source and migrations
rsync -az --exclude target --exclude .git \
  backend/src/       redstonecipher-web:/opt/redstonecipher/src/src/
rsync -az backend/migrations/ redstonecipher-web:/opt/redstonecipher/src/migrations/

# 2. Build on the server
ssh redstonecipher-web 'cd /opt/redstonecipher/src && cargo build --release'

# 3. Swap binary and restart (migrations apply automatically on startup)
ssh redstonecipher-web '
  cp /opt/redstonecipher/src/target/release/redstonecipher-server \
     /opt/redstonecipher/redstonecipher-server && \
  systemctl restart redstonecipher
'
```

### Deploy a new frontend build

```bash
# From the repo root — builds and rsyncs in one step:
bash scripts/deploy-frontend.sh
```

Or manually:
```bash
cd frontend && npm run build
rsync -az --delete --exclude /map dist/ redstonecipher-web:/opt/redstonecipher/www/
```

### Deploy world management scripts (mc-server-1)

Required when `scripts/world-switch.sh` or `scripts/world-backup.sh` change:

```bash
# Stage scripts on the web server, then push to mc-server-1
scp scripts/world-switch.sh scripts/world-backup.sh \
    redstonecipher-web:/tmp/

ssh redstonecipher-web "
  scp -i /opt/redstonecipher/mc_ssh_key \
      /tmp/world-switch.sh /tmp/world-backup.sh \
      root@100.123.253.30:/opt/minecraft/scripts/ && \
  ssh -i /opt/redstonecipher/mc_ssh_key root@100.123.253.30 \
    'chmod +x /opt/minecraft/scripts/world-switch.sh \
               /opt/minecraft/scripts/world-backup.sh'
"
```

### Create a new world

Via the web UI: **Admin → Worlds → New World**.

This creates the DB record and `mkdir`-s `/opt/minecraft/worlds/{slug}/` and `/opt/minecraft/backups/{slug}/{daily,weekly}/` on mc-server-1 over SSH.

### Switch the active world

Via the web UI: **Admin → Worlds → Switch** on the target world card.

Or via API (requires `worlds.switch` permission):
```bash
curl -s -X POST -b "__session=<JWT>" \
  https://redstonecipher.com/api/worlds/<id>/activate
# Returns 202 Accepted — switch runs synchronously (1–3 min for large worlds)
```

The switch script (`/opt/minecraft/scripts/world-switch.sh`) performs these steps in order:
1. RCON `save-all flush` (flushes pending chunk writes)
2. `systemctl stop minecraft`
3. `rsync` current `server/world*` → `/opt/minecraft/worlds/{current_slug}/`
4. `rm -rf server/world*`
5. `rsync` target world in (or leave empty — MC generates a fresh world)
6. `systemctl start minecraft` + health-check loop (up to 60 s)
7. Prints `DONE` — backend only updates the DB `is_active` flag after this

**Safety**: if step 3 fails, the script aborts and restarts the server with the original world. The DB flag is never updated on failure.

### Create a world backup manually

Via the web UI: **Admin → Worlds → expand world → Backup Now**.

Or via API:
```bash
curl -s -X POST -b "__session=<JWT>" \
  https://redstonecipher.com/api/worlds/<id>/backups
# Returns 201 with the new BackupRun record
```

Or directly on mc-server-1:
```bash
ssh mc-server 'bash /opt/minecraft/scripts/world-backup.sh survival'
# Output: /opt/minecraft/backups/survival/daily/2026-05-13_12-00.tar.gz
```

### Download a world backup

Via the web UI: **Admin → Worlds → expand world → Download** (↓ icon).

Or via API (streams the `.tar.gz` directly from mc-server-1):
```bash
curl -b "__session=<JWT>" \
  https://redstonecipher.com/api/worlds/<world_id>/backups/<backup_id> \
  -o backup.tar.gz
```

### Check backup health

```bash
# List all world backup directories and file counts
ssh mc-server '
  for d in /opt/minecraft/backups/*/daily; do
    count=$(ls "$d"/*.tar.gz 2>/dev/null | wc -l)
    echo "$d: $count backup(s)"
  done
'

# Check backup sizes
ssh mc-server 'du -sh /opt/minecraft/backups/*/*/'
```

### Renew SSL certificate (manual)

Certbot auto-renews twice daily via its own systemd timer; manual renewal is only needed for troubleshooting.

```bash
ssh redstonecipher-web 'certbot renew --nginx'
```

### View live server logs

```bash
# Minecraft
ssh mc-server 'journalctl -u minecraft -f'

# Backend
ssh redstonecipher-web 'journalctl -u redstonecipher -f'
```

### Invite a new user

Sign in at **https://redstonecipher.com** with a `global_admin` or `admin` account and use the Users page to invite the new user.

### Add a player to the Minecraft whitelist

See [Whitelist](#whitelist) above.

---

## Music Queue

The music queue lets any user with the `music.play` permission queue vanilla or
custom tracks that play for **all online players** simultaneously — no client
mods required. It uses the vanilla `/playsound` command over the existing
Minecraft console FIFO bridge.

### How it works

```
Browser → POST /api/music/queue → Rust backend
                                      │
              ┌───────────────────────┤
              │ 1. resolve track metadata
              │ 2. stopsound @a music     (clears ambient/game music)
              │ 3. playsound <id> music @a ~ ~ ~ 1000000 1
              └──→ SSH → Tailscale → /opt/minecraft/console.fifo
                                      │
              ┌───────────────────────┤
              │ 4. SSE broadcast new state
              └──→ all open /music tabs update instantly
```

A background Tokio task polls elapsed time every 5 s and auto-advances the
queue when the current track's duration expires.

### Tracks

**Vanilla** — 19 Minecraft 1.21 disc sounds (C418, Lena Raine, etc.) are
baked into the binary. No configuration required.

**Custom** — stored in the `music_custom_tracks` DB table. Require a resource
pack uploaded to `/opt/redstonecipher/www/resource-pack.zip` and auto-registered
in `server.properties` by the upload API.

### Resource pack flow

1. User uploads a `.zip` via `POST /api/music/resource-pack`.
2. Backend saves to `/opt/redstonecipher/www/resource-pack.zip`.
3. Backend runs `sha1sum` and writes `resource-pack` + `resource-pack-sha1`
   into `server.properties` on the MC server via SSH (no restart needed).
4. Players download the pack automatically on next (re)join.
5. Backend parses `assets/<namespace>/sounds.json` in the zip and returns
   detected sound events so the UI can offer one-click track registration.

Starter template: `https://redstonecipher.com/resource-pack-template.zip`

### Sound ID format

```
namespace:event.name
─────────  ──────────
folder under     key in
assets/          sounds.json

e.g.  redstonecipher:music.my_song
  file  →  assets/redstonecipher/sounds/music/my_song.ogg
  JSON  →  assets/redstonecipher/sounds.json { "music.my_song": { ... } }
```

### Permissions

| Key | Default roles | Description |
|---|---|---|
| `music.play` | `member`, `admin`, `global_admin` | Queue tracks, upload resource pack, register custom tracks |

### API reference

| Method | Path | Description |
|---|---|---|
| `GET`    | `/api/music/tracks`               | Unified catalog (vanilla + custom) |
| `GET`    | `/api/music/state`                | Now-playing + queue snapshot |
| `GET`    | `/api/music/stream`               | SSE — fires on every state change |
| `POST`   | `/api/music/queue`                | Enqueue a track |
| `DELETE` | `/api/music/queue/:id`            | Remove a queued entry |
| `POST`   | `/api/music/skip`                 | Skip current track |
| `POST`   | `/api/music/stop`                 | Stop all + clear queue |
| `POST`   | `/api/music/tracks`               | Register a custom track |
| `DELETE` | `/api/music/tracks/:sound_id`     | Remove a custom track |
| `GET`    | `/api/music/resource-pack`        | Pack status, SHA1, size |
| `GET`    | `/api/music/resource-pack/sounds` | Sounds detected in installed pack |
| `POST`   | `/api/music/resource-pack`        | Upload pack (multipart field `pack`) |
| `DELETE` | `/api/music/resource-pack`        | Remove pack + clear server.properties |

### DB schema

```sql
-- migration 0021
CREATE TABLE music_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sound_id     TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    requested_by TEXT    NOT NULL,
    queued_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- migration 0022
CREATE TABLE music_custom_tracks (
    sound_id      TEXT    PRIMARY KEY,  -- e.g. "redstonecipher:music.my_song"
    display_name  TEXT    NOT NULL,
    artist        TEXT    NOT NULL DEFAULT '',
    duration_secs INTEGER NOT NULL DEFAULT 180,
    added_by      TEXT    NOT NULL,
    added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### Key file paths (web server)

| Path | Purpose |
|---|---|
| `/opt/redstonecipher/www/resource-pack.zip` | Installed resource pack (served at `/resource-pack.zip`) |
| `/opt/redstonecipher/www/resource-pack-template.zip` | Starter template (always present) |

### Troubleshooting

**Track queues but no sound plays**
```bash
# 1. Is MC running?
ssh mc-server 'systemctl is-active minecraft'
# 2. Does the FIFO exist?
ssh mc-server 'test -p /opt/minecraft/console.fifo && echo OK'
# 3. Backend SSH errors?
journalctl -u redstonecipher -n 50 --no-pager | grep -i music
```
`"No player was found"` in the MC log is expected when nobody is online —
the command reached the server; it will work once a player joins.

**Custom track not audible after registration**
- Confirm pack is installed: `GET /api/music/resource-pack` → `{"installed":true}`
- Confirm `server.properties`: `grep resource-pack /opt/minecraft/server/server.properties`
- Player must re-join after the pack is uploaded to trigger the download.
- Sound ID must exactly match a key in `assets/<namespace>/sounds.json`.
- Audio must be **OGG Vorbis** — other formats are silently ignored by Minecraft.

**deploy-backend.sh rsync bug**
The script incorrectly mixes local sources and remote destinations in one
`rsync` call. Until fixed, deploy manually:
```bash
SERVER=root@178.105.43.199
rsync -az backend/src/        $SERVER:/opt/redstonecipher/backend/src/
rsync -az backend/Cargo.toml  $SERVER:/opt/redstonecipher/backend/
rsync -az backend/Cargo.lock  $SERVER:/opt/redstonecipher/backend/
rsync -az backend/migrations/ $SERVER:/opt/redstonecipher/backend/migrations/
ssh $SERVER 'cd /opt/redstonecipher/backend && cargo build --release'
ssh $SERVER 'systemctl stop redstonecipher && \
  cp target/release/redstonecipher-server /opt/redstonecipher/redstonecipher-server && \
  systemctl start redstonecipher'
```

---

## Service Dependencies

```
minecraft-backup.timer  →  minecraft-backup.service
                              └─ runs /opt/minecraft/backup.sh (legacy flat backup)
mc-fifo-bridge.service  →  /opt/minecraft/console.fifo  →  minecraft.service
redstonecipher.service  →  network.target, tailscaled.service
  └─ on startup: runs sqlx migrations + syncs backup metadata from mc-server-1
nginx                   →  redstonecipher.service (proxy_pass 127.0.0.1:8080)

# World management (on-demand, triggered by API)
POST /api/worlds/:id/activate  →  SSH → world-switch.sh  →  systemctl stop/start minecraft
POST /api/worlds/:id/backups   →  SSH → world-backup.sh  →  tar.gz in backups/{slug}/daily/

# Music queue (real-time, triggered by API)
POST /api/music/queue  →  SSH → console.fifo → stopsound + playsound
                       →  SSE broadcast → all /music tabs
```

> **Note**: Per-world backups triggered via the API (`world-backup.sh`) are separate from the
> legacy `minecraft-backup.timer`. To migrate the cron job to per-world backups, update
> `/etc/systemd/system/minecraft-backup.service` to call
> `bash /opt/minecraft/scripts/world-backup.sh survival` instead of `/opt/minecraft/backup.sh`.

---

## Deployment History

### 2026-05-20 — Music queue, custom tracks, resource pack

- Migrations 0021 (`music_queue`) and 0022 (`music_custom_tracks`) applied.
- New `music.play` permission seeded for `member`/`admin`/`global_admin`.
- 19 vanilla disc sounds baked into the binary (no DB/config required).
- Resource pack API: upload stores to `www/resource-pack.zip`, SHA-1 computed and
  written to `server.properties` via SSH (no server restart needed).
- `GET /api/music/resource-pack/sounds` added — parses installed pack's `sounds.json`
  and returns detected sound events (powers the UI auto-detect panel).
- Frontend `/music` page: Now Playing progress bar, Up Next queue, Track Catalog with
  search, Custom Music setup card (pack upload, sounds auto-detect, Sound ID
  validation with `/playsound` command preview, MM:SS duration picker).
- Starter resource pack template published at `/resource-pack-template.zip`.
- Build fixes: `postcss.config.js` restored (was missing → empty CSS bundle);
  static assets (`favicon.svg`, weather images) moved to `frontend/public/`
  so `vite build --emptyOutDir` no longer deletes them.

### 2026-05-13 — Multi-world management

- Added `worlds` and `world_members` tables (migration 0017).
- `backup_runs` extended with `world_id`/`world_slug`; existing backups back-filled to `survival`.
- `world-switch.sh` and `world-backup.sh` deployed to `/opt/minecraft/scripts/` on mc-server-1.
- Directory structure created: `/opt/minecraft/worlds/` and `/opt/minecraft/backups/survival/{daily,weekly}/`.
- New API: `GET/POST /api/worlds`, `POST /api/worlds/:id/activate`, `GET/PUT /api/worlds/:id/members`, `GET/POST/GET /api/worlds/:id/backups[/:backup_id]`.
- Admin → Worlds tab added (world cards, create modal, switch confirmation, member pills, per-world backup list + download).
- Backups page updated with world slug badges.
- Six new permission keys: `worlds.view`, `worlds.create`, `worlds.switch`, `worlds.delete`, `worlds.members.manage`, `worlds.backups.create`.

### 2026-05-03 — Hetzner migration

- Migrated from Google Cloud (Firebase + Cloud Run + GCE) to Hetzner bare servers.
- All GCP projects decommissioned (`redstonecipher-web`, `minecraft-493201`, `g-bridges`).
- Rust/Axum backend deployed as a systemd service on `178.105.43.199`.
- PaperMC server running on `5.161.212.29`, accessible only via Tailscale.
- SSL via Let's Encrypt / certbot; nginx reverse proxy.
- Auth: invite-only Google OAuth with role-based permission model.
- Whitelist enforcement enabled (`white-list=true`, `enforce-whitelist=true`).
- Daily backup at 04:00 UTC via `minecraft-backup.timer`.


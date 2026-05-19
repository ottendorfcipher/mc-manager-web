# redstoneCipher — Web Edition

A web portal for managing a private Minecraft server. Built with Rust (Axum), React (TypeScript), and SQLite.

## Architecture

```
Public internet
    │
    ├── 443/tcp  → redstonecipher.com (178.105.43.199) — nginx + Rust/Axum + SQLite
    │                      │
    │              Tailscale WireGuard mesh
    │                      │
    └── (blocked) 25565/tcp → mc-server-1 (100.123.253.30) — PaperMC 1.21.11
```

- **`redstonecipher.com`** — Hetzner VPS (38 GB), nginx reverse proxy in front of the Rust binary
- **Rust/Axum backend** — single binary at `/opt/redstonecipher/redstonecipher-server`, serving the React SPA and all `/api/` + `/auth/` + `/internal/` routes
- **SQLite** — WAL-mode database at `/opt/redstonecipher/data/mc-manager.db`
- **Google OAuth2 PKCE** — invite-only; admins add users by email, users sign in with Google
- **Tailscale VPN** — all admin traffic (SSH, RCON, MC console) flows over the WireGuard mesh; Minecraft port 25565 is Tailscale-only
- **mc-server-1** — Hetzner VPS (75 GB), PaperMC, port 25565 restricted to `tailscale0` interface via UFW
- **Player admission queue** — watchdog service on mc-server-1 detects first-time Tailscale joins, registers them as pending, and enforces approval via the site
- **Multi-world management** — admins create named world slots, switch the active world (server saves current, loads target, restarts), and manage per-world backups and player group assignments from the Admin → Worlds tab

## Quick Start

### Prerequisites
- Rust 1.88+ (`rustup update`)
- Node 22+ (`node --version`)
- SSH access to both servers via Tailscale (see `ssh/config-snippet.txt` in the `mc-server` config repo)

### 1. Configure
```bash
cp .env.example .env
# Fill in all required values — see .env.example for descriptions
openssl rand -hex 32   # use output as JWT_SECRET
openssl rand -hex 32   # use output as WATCHDOG_TOKEN
```

**Google OAuth setup (one-time):**
1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create → OAuth 2.0 Client ID → Web application
3. Authorized redirect URIs: `https://redstonecipher.com/auth/callback` (prod), `http://localhost:8787/auth/callback` (dev)
4. Copy Client ID and Client Secret into `.env`

### 2. Run (development)
```bash
# Terminal 1 — Rust backend
cd backend && cargo run

# Terminal 2 — React frontend with hot reload
cd frontend && npm run dev
```
Open http://localhost:5173 — API calls are proxied to `:8787` via `vite.config.ts`.

### 3. Run (production)
See [Deploying](#deploying) below — production builds are always done on the server.

## Testing
```bash
# Rust unit tests
cd backend && cargo test

# Playwright E2E tests (requires npm run dev running)
cd frontend && npx playwright test

# Security / SAST sweep
bash scripts/security-check.sh
```

## Deploying

Deployments are manual. The build must happen **on the server** because the web server is x86_64 Linux and local machines may be a different architecture.

### Deploy frontend
```bash
cd frontend && npm run build
rsync -av --delete dist/ redstonecipher-web:/opt/redstonecipher/www/
```

### Deploy backend
```bash
# 1. Sync changed source files to the server
rsync -av --exclude target --exclude .git backend/ redstonecipher-web:/opt/redstonecipher/src/

# 2. Build on the server (x86_64 native)
ssh redstonecipher-web "
  source ~/.cargo/env &&
  cd /opt/redstonecipher/src &&
  cargo build --release
"

# 3. Stop, swap binary, restart
ssh redstonecipher-web "
  systemctl stop redstonecipher &&
  cp /opt/redstonecipher/src/target/release/redstonecipher-server /opt/redstonecipher/redstonecipher-server &&
  systemctl start redstonecipher
"
```

### Deploy watchdog (mc-server-1)
Only needed when `player-watchdog.sh` changes:
```bash
scp player-watchdog.sh mc-server-1:/opt/minecraft/player-watchdog.sh
ssh mc-server-1 "chmod +x /opt/minecraft/player-watchdog.sh && systemctl restart mc-player-watchdog"
```

### Verify deployment
```bash
# Backend API responds
curl -s https://redstonecipher.com/api/server/status   # expects 401 (not 502)

# Watchdog is running
ssh mc-server-1 "systemctl is-active mc-player-watchdog"
```

## Project Structure
```
backend/              Rust Axum server — API, auth, SSH/MC integration
  migrations/         SQLite schema migrations (sqlx)
    0017_worlds.sql   Multi-world: worlds, world_members, backup tagging
  src/
    auth/             Google OAuth PKCE + JWT middleware
    config.rs         All config loaded from environment variables
    db/               SQLite access layer
      backups.rs      Backup metadata — now includes world_id / world_slug
      pending_players.rs  Tailscale admission queue
      players.rs          IGN ↔ site user linking (player_links table)
      users.rs            Invite-only user management
      worlds.rs           World CRUD + world_members management
    handlers/         Axum route handlers
      backups.rs          Legacy global backups (POST /api/backups)
      pending_players.rs  POST /internal/player-joined (watchdog) + admin queue APIs
      server.rs           Whitelist, op, kick, ban, gamerule, console
      worlds.rs           Full world management API (see below)
    minecraft/
      backup.rs           Backup sync — legacy flat dir + per-world dirs
      world_switch.rs     SSH orchestration for world switching and backups
    gcloud/
      ssh.rs          SSH to mc-server-1 over Tailscale
frontend/             React + TypeScript SPA
  src/
    features/
      admin/          AdminPage — Users, Roles, Pairing, Pending Players, Whitelist, Worlds
        WorldsTab.tsx World cards, create modal, switch confirmation, members, per-world backups
      backups/        BackupsPage — legacy backups with world_slug badge
      server-control/ ServerPage — VM control, whitelist, gamerules, weather/time
    types/index.ts    TypeScript types mirroring Rust structs
scripts/
  world-switch.sh     Deployed to mc-server-1 — atomic world swap with safety guarantees
  world-backup.sh     Deployed to mc-server-1 — per-world backup to /opt/minecraft/backups/<slug>/
README.md             This file
DEPLOYMENT.md         Detailed server layout, runbooks, and service dependencies
```

## Player Admission Flow

Minecraft port 25565 is Tailscale-only. The vanilla whitelist is disabled; admission is controlled by `mc-player-watchdog.service` on mc-server-1:

1. New player joins via Tailscale → watchdog calls `POST /internal/player-joined` → `allow` (first session permitted)
2. Player appears in **Admin → Pending Players** on the site
3. Admin clicks **Approve & Link** → player is linked to a site user → future joins get `allow`
4. If **Rejected** → all future join attempts are kicked immediately

See `DEPLOYMENT.md` for the watchdog systemd unit and full server configuration.

---

## World Management

Admins can create named world slots, switch the active world, and manage per-world backups and player group assignments from **Admin → Worlds**.

### How it works

- **Active world** always lives in `/opt/minecraft/server/world*` on mc-server-1 — unchanged from vanilla Minecraft's perspective.
- **Inactive worlds** are stored in `/opt/minecraft/worlds/{slug}/` as live directories (not archives).
- **Switching worlds** (via `POST /api/worlds/:id/activate`) runs `scripts/world-switch.sh` over SSH:
  1. RCON flushes saves, server is stopped
  2. Current world `rsync`-ed out to `/opt/minecraft/worlds/{current_slug}/` — **current world is always saved first**
  3. Target world `rsync`-ed into `server/world*` (or left empty for fresh Minecraft generation)
  4. Server restarts and health-checks; the DB `is_active` flag is only updated after `DONE` is received
  5. A failed switch leaves DB state unchanged and world files intact
- **Backups** are stored in `/opt/minecraft/backups/{slug}/daily/` — 7 daily + 4 weekly retained per world. Legacy flat backups in `/opt/minecraft/backups/daily/` remain accessible.

### API endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/worlds` | `worlds.view` | List all worlds |
| `POST` | `/api/worlds` | `worlds.create` | Create a new world slot |
| `DELETE` | `/api/worlds/:id` | `worlds.delete` | Delete a non-active world (DB record only) |
| `POST` | `/api/worlds/:id/activate` | `worlds.switch` | Switch the active world (restarts MC) |
| `GET` | `/api/worlds/:id/members` | `worlds.view` | List users assigned to this world |
| `PUT` | `/api/worlds/:id/members` | `worlds.members.manage` | Replace the member list |
| `GET` | `/api/worlds/:id/backups` | `worlds.view` | List backups for this world |
| `POST` | `/api/worlds/:id/backups` | `worlds.backups.create` | Create a backup for this world |
| `GET` | `/api/worlds/:id/backups/:backup_id` | `worlds.view` | Download a world backup |

**Create world body:**
```json
{ "name": "Creative", "slug": "creative", "description": "Build server", "seed": "12345" }
```
`slug` must be lowercase alphanumeric + hyphens/underscores; used as the directory name on mc-server-1.

**List worlds response:**
```json
[
  { "id": 1, "name": "Survival", "slug": "survival", "is_active": true,
    "description": "The main survival world", "seed": null,
    "created_at": "2026-05-12T04:55:12Z", "created_by": "system" }
]
```

**List backups response:**
```json
[
  { "id": 5, "filename": "2026-05-12_04-00.tar.gz",
    "file_path": "/opt/minecraft/backups/survival/daily/2026-05-12_04-00.tar.gz",
    "size_bytes": 89234567, "created_at": "2026-05-12T04:00:00Z",
    "world_id": 1, "world_slug": "survival", "notes": null, "created_by": "mc-server-1" }
]
```

### Deploying the world management scripts

Required when `scripts/world-switch.sh` or `scripts/world-backup.sh` change:

```bash
# Copy scripts to mc-server-1
ssh redstonecipher-web "
  scp -i /opt/redstonecipher/mc_ssh_key \
      /tmp/world-switch.sh /tmp/world-backup.sh \
      root@100.123.253.30:/opt/minecraft/scripts/
  ssh -i /opt/redstonecipher/mc_ssh_key root@100.123.253.30 \
    'chmod +x /opt/minecraft/scripts/world-switch.sh /opt/minecraft/scripts/world-backup.sh'
"

# Ensure directory structure exists on mc-server-1 (one-time)
ssh mc-server 'mkdir -p /opt/minecraft/worlds /opt/minecraft/backups/survival/{daily,weekly}'
```

---

## Coordinate Display API

Per-player coordinate HUD toggle, surfaced in the **Team** tab.

### How it works

A Minecraft [datapack](scripts/coords-hud/) is deployed to mc-server-1. When active, each player can run `/trigger ch_toggle` in-game chat to toggle a small coordinate readout (`X ___ Y ___ Z ___`) displayed above their hotbar. The display is per-player and invisible to everyone else.

Admins and the player themselves can also toggle the setting from the **Team** tab in the web interface — the badge on each player chip shows green **XYZ** (on) or grey **XYZ** (off).

### API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/api/players/:ign/coord-display` | Member (own IGN) or admin | Returns `{ enabled, online, ign }` |
| `POST` | `/api/players/:ign/coord-display` | Member (own IGN) or admin | Body: `{ "enabled": true\|false }` |

**GET response:**
```json
{ "enabled": false, "online": true, "ign": "ChaoticLuc" }
```

**POST body:**
```json
{ "enabled": true }
```
Returns `204 No Content` on success.

### State management

The DB (`preferences` table, key `coord_display:<ign>`) is the source of truth for the web interface. On every POST:
- **Online player** → instant `tag <ign> add/remove ch_on` via FIFO console pipe (takes effect within one datapack tick, ~50ms)
- **Offline player** → direct NBT edit of `world/playerdata/<uuid>.dat` via `scripts/coord-display.py` (takes effect on next login)

### Deploying the datapack to a new server

```bash
# From the repo root:
scp -r scripts/coords-hud root@<mc-server>:/opt/minecraft/server/world/datapacks/
# Then in-game or via console:
/reload
```

Requires Minecraft 1.20.6+ (Paper). The datapack uses the `function` (singular) tag path introduced in pack format 41.

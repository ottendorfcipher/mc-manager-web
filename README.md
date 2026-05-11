# redstoneCipher — Web Edition

A web portal for managing a private Minecraft server. Built with Rust (Axum), React (TypeScript), and SQLite.

## Architecture

```
Public internet
    │
    ├── 443/tcp  → example.com (203.0.113.10) — nginx + Rust/Axum + SQLite
    │                      │
    │              Tailscale WireGuard mesh
    │                      │
    └── (blocked) 25565/tcp → mc-server-1 (100.64.0.2) — PaperMC 1.21.11
```

- **`example.com`** — Hetzner VPS (38 GB), nginx reverse proxy in front of the Rust binary
- **Rust/Axum backend** — single binary at `/opt/redstonecipher/redstonecipher-server`, serving the React SPA and all `/api/` + `/auth/` + `/internal/` routes
- **SQLite** — WAL-mode database at `/opt/redstonecipher/data/mc-manager.db`
- **Google OAuth2 PKCE** — invite-only; admins add users by email, users sign in with Google
- **Tailscale VPN** — all admin traffic (SSH, RCON, MC console) flows over the WireGuard mesh; Minecraft port 25565 is Tailscale-only
- **mc-server-1** — Hetzner VPS (75 GB), PaperMC, port 25565 restricted to `tailscale0` interface via UFW
- **Player admission queue** — watchdog service on mc-server-1 detects first-time Tailscale joins, registers them as pending, and enforces approval via the site

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
3. Authorized redirect URIs: `https://example.com/auth/callback` (prod), `http://localhost:8787/auth/callback` (dev)
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
curl -s https://example.com/api/server/status   # expects 401 (not 502)

# Watchdog is running
ssh mc-server-1 "systemctl is-active mc-player-watchdog"
```

## Project Structure
```
backend/              Rust Axum server — API, auth, SSH/MC integration
  migrations/         SQLite schema migrations (sqlx)
  src/
    auth/             Google OAuth PKCE + JWT middleware
    config.rs         All config loaded from environment variables
    db/               SQLite access layer
      pending_players.rs  Tailscale admission queue
      players.rs          IGN ↔ site user linking (player_links table)
      users.rs            Invite-only user management
    handlers/         Axum route handlers
      pending_players.rs  POST /internal/player-joined (watchdog) + admin queue APIs
      server.rs           Whitelist, op, kick, ban, gamerule, console
    gcloud/
      ssh.rs          SSH to mc-server-1 over Tailscale (replaces gcloud IAP)
frontend/             React + TypeScript SPA
  src/
    features/
      admin/          AdminPage — Users, Roles, Pairing, Pending Players, Whitelist
      server-control/ ServerPage — VM control, whitelist, gamerules, weather/time
    types/index.ts    TypeScript types mirroring Rust structs
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

# redstoneCipher — Web Edition

A web portal for managing a private Minecraft server. Invite-only, role-based, deployed on Hetzner bare servers connected via Tailscale VPN.

## Architecture

```
Internet → nginx (TLS) → Rust/Axum backend → SQLite (WAL mode)
                              │
                        Tailscale VPN
                              │
                     PaperMC 1.21.11 (mc-server-1)
```

- **Web server** (`example.com`, 203.0.113.10) — Hetzner VPS, nginx reverse-proxying to a single Rust binary
- **MC server** (`mc-server-1`, Tailscale 100.64.0.2) — Hetzner VPS, PaperMC, port 25565 restricted to Tailscale only
- **Auth** — Google OAuth2 PKCE, invite-only; JWT (HS256, 8h) in HttpOnly cookie
- **Database** — SQLite at `/opt/redstonecipher/data/mc-manager.db`, migrations in `backend/migrations/`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust 1.88+, Axum 0.7, SQLx (SQLite), tokio |
| Frontend | React 19, TypeScript 6, Vite 8, TailwindCSS 3, Zustand, TanStack Query/Router |
| UI components | Radix UI primitives, Lucide icons, Recharts, Leaflet (map) |
| Infrastructure | nginx, systemd, Tailscale, Let's Encrypt |
| E2E testing | Playwright |
| Backend testing | `cargo test` (axum-test) |
| Discord integration | Serenity (bot gateway) + webhook |

## Project Layout

```
backend/
  src/
    main.rs                 Entry point — logging, config, DB init, Discord setup
    lib.rs                  Re-exports for the library crate
    config.rs               All config loaded from environment variables
    state.rs                Shared application state (AppState)
    error.rs                AppError — single error type wrapping all variants
    middleware.rs            Request-level middleware (CORS, compression, etc.)
    auth/                   Google OAuth PKCE flow + JWT middleware
    db/                     SQLite data access layer (one file per domain)
    handlers/               Axum route handlers (one file per feature)
    minecraft/              MC server interaction — SSH/RCON via Tailscale
      backup.rs             Backup sync from mc-server-1
      chat_watcher.rs       Real-time chat bridge
      console.rs            FIFO console command execution
      music.rs              Music queue playback engine
      world_switch.rs       SSH orchestration for world switching
    gcloud/                 GCP utilities (SSH, storage — legacy, being phased out)
    discord/                Discord bot + webhook bridge
  migrations/               SQLx SQLite migrations (0001–0022)
  bindings/                 Auto-generated TypeScript types (ts-rs)
  tests/                    Integration tests (api.rs)
  Cargo.toml                Dependencies and build profile

frontend/
  src/
    main.tsx                React entry point
    App.tsx                 Root component with routing
    api/client.ts           Fetch wrapper for backend API
    types/index.ts          TypeScript types mirroring Rust structs
    store/auth.ts           Zustand auth store
    hooks/                  Custom React hooks (useAuth, useMetrics, useHotkeys, useFocusTrap)
    components/             Shared UI components (Layout, Toast, Badge, ConfirmDialog, etc.)
    features/               Feature modules, each with its own page component:
      admin/                User management, roles, permissions, pending players, worlds
      auth/                 Login page, OAuth callback, Minecraft backdrop
      backups/              Backup listing with world badges
      chat/                 Real-time chat bridge (SSE)
      configure/            Server settings editor
      dashboard/            Server status overview with metrics charts
      map/                  Leaflet-based live player map with item giving
      music/                Music queue — now playing, track catalog, resource packs
      onboarding/           First-time setup wizard
      players/              Player list with IGN linking and item giving
      server-control/       VM control, whitelist, gamerules, weather/time
      team/                 Team member view with coordinate display toggles
  e2e/                      Playwright E2E test specs
  public/                   Static assets (favicon, weather images, resource pack template)
  vite.config.ts            Vite dev server config (HTTPS, proxy to backend)
  tailwind.config.js        Tailwind theme configuration
  playwright.config.ts      Playwright test runner config
  tsconfig.json             TypeScript project references root

scripts/                    Operational scripts
  deploy-backend.sh         Build and deploy Rust binary to web server
  deploy-frontend.sh        Build React and rsync to web server
  deploy-watchdog.sh        Deploy admission watchdog to mc-server-1
  backup-db.sh              Daily SQLite backup
  world-switch.sh           Atomic world swap on mc-server-1
  world-backup.sh           Per-world backup to mc-server-1
  set-api-keys.sh           Securely configure API keys on live server
  coord-display.py          Offline player NBT editing for coordinate HUD
  get-player-data.py        Fetch player data from Mojang API
  give-item.py              Give items via RCON
  coords-hud/               Minecraft datapack for in-game coordinate display

infra/
  redstonecipher.service    systemd unit for the Rust backend
  minecraft.service         systemd unit for PaperMC
  mc-watchdog/              Tailscale admission watchdog (Python)
  security/                 Server hardening scripts and nginx rate-limit config
  setup-bluemap-acl.sh      BlueMap ACL configuration

docs/ux/                    UX analysis documents (heuristics, accessibility, SWOT)
```

## Development

### Prerequisites

- Rust 1.88+ (`rustup update`)
- Node 22+ (`node --version`)
- SQLite 3
- SSH access to both servers via Tailscale (for full integration testing)

### Running locally

```bash
# 1. Configure environment
cp .env.example .env
# Fill in required values (see .env.example for descriptions)

# 2. Backend (terminal 1)
cd backend && cargo run

# 3. Frontend (terminal 2)
cd frontend && npm install && npm run dev
```

The Vite dev server runs at `https://localhost:5173` and proxies `/api/*` and `/auth/*` to the backend at `:8787`.

Optional: place mkcert certificates in `frontend/certs/` for local HTTPS (see `vite.config.ts`).

### Testing

```bash
# Rust unit/integration tests
cd backend && cargo test

# Frontend type checking
cd frontend && npm run typecheck

# Frontend linting
cd frontend && npm run lint

# Full frontend analysis (typecheck + lint + copy-paste detection + type coverage + dead code)
cd frontend && npm run analyze

# Playwright E2E (requires dev server running)
cd frontend && npx playwright test
```

### Building for production

Builds must happen on the server (x86_64 Linux target):

```bash
# Frontend
cd frontend && npm run build

# Backend (on the server)
cd backend && cargo build --release
```

## Key Concepts

### Permission Model

Role-based with per-user overrides. Five system roles (visitor → global_admin, levels 0–4). Custom roles can be created below the creator's level. Permissions are checked from the DB on every request — changes are instant.

### World Management

Multiple world slots stored in `/opt/minecraft/worlds/{slug}/`. The active world always lives in `/opt/minecraft/server/world*`. Switching uses `world-switch.sh` over SSH: save → stop → rsync out → rsync in → start → health check. The DB flag only updates on success.

### Music Queue

Vanilla `/playsound` commands over a FIFO console bridge. Supports 19 built-in disc tracks + custom tracks via uploaded resource packs. State broadcast via SSE to all connected clients. Background Tokio task auto-advances the queue.

### Player Admission

Minecraft port is Tailscale-only. A watchdog service on mc-server-1 detects first-time joins and registers them as pending. Admins approve/reject via the web UI.

### Discord Bridge

Bidirectional chat bridge using Serenity (bot gateway for Discord→MC) and webhooks (MC→Discord). Credentials stored encrypted (AES-256-GCM) in the SQLite `app_settings` table.

## TypeScript Bindings

The backend uses `ts-rs` to auto-generate TypeScript type definitions in `backend/bindings/`. These mirror the Rust structs used in API responses. When modifying backend response types, run `cargo test` to regenerate the bindings.

## Database Migrations

SQLite migrations are in `backend/migrations/` (0001–0022). They run automatically on backend startup via SQLx. Migration files are plain SQL and must be idempotent-safe.

## Deployment

Deployments are manual via rsync + SSH. See `DEPLOYMENT.md` for full runbooks, server layout, service dependencies, and troubleshooting guides.

Key deploy scripts:
- `scripts/deploy-frontend.sh` — builds and rsyncs the React SPA
- `scripts/deploy-backend.sh` — syncs source to server, builds natively, swaps binary
- `scripts/deploy-watchdog.sh` — deploys the admission watchdog to mc-server-1

## Environment Variables

See `.env.example` for the full list. Required:
- `DATABASE_URL` — SQLite connection string
- `JWT_SECRET` — 64-char hex string for JWT signing
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth credentials

Optional: `GCP_*`, `TAILSCALE_*`, `GCS_BACKUP_BUCKET`, `RESEND_API_KEY`, Discord credentials.

## Conventions

- Backend error handling uses a single `AppError` type (thiserror) that maps to HTTP status codes
- Frontend API calls go through `api/client.ts` which handles auth token refresh
- Feature modules are self-contained: each has its own page component, and related API calls are co-located
- Tailwind for styling; Radix UI for accessible primitives
- State management: Zustand for auth, TanStack Query for server state
- Real-time updates use SSE (Server-Sent Events) for chat and music queue

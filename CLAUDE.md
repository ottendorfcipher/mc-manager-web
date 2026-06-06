# redstoneCipher — Web Edition

A web portal for managing a private, invite-only Minecraft server. Role-based
access, deployed on Hetzner VPS hosts connected over a Tailscale VPN.

## Architecture

```
Internet → nginx (TLS) → Rust/Axum backend → SQLite (WAL mode)
                              │
                        Tailscale VPN
                              │
                     PaperMC 1.21.11 (mc-server-1)
```

- **Web server** (`redstonecipher.com`, `178.105.43.199`) — Hetzner VPS, nginx
  reverse-proxying to a single Rust binary (default bind `:8787`).
- **MC server** (`mc-server-1`, Tailscale `100.123.253.30`) — Hetzner VPS,
  PaperMC 1.21.11, port 25565 reachable only over Tailscale. Reached from the
  backend via SSH (key `/opt/redstonecipher/mc_ssh_key`, known-hosts
  `/opt/redstonecipher/mc_known_hosts`) and RCON.
- **Auth** — Google OAuth2 (PKCE), invite-only; JWT (HS256, 8h) in an HttpOnly
  cookie named `__session`. Plus in-game QR / link-token SSO.
- **Database** — SQLite at `/opt/redstonecipher/data/mc-manager.db`; migrations
  in `backend/migrations/` run automatically on startup.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust 1.88 (pinned via `backend/rust-toolchain.toml`), Axum 0.7, SQLx (SQLite), tokio |
| Frontend | React 19, TypeScript 6, Vite 8 (rolldown), TailwindCSS 3, Zustand, TanStack Query/Router |
| UI | Radix UI primitives, Lucide icons, Recharts, Leaflet (map) |
| Infrastructure | nginx, systemd (sandboxed unit), Tailscale, Let's Encrypt |
| Discord | Serenity (bot gateway) + webhooks |
| Plugins | Modrinth API integration (search / install / auto-update) |
| Testing | `cargo test` (axum-test); Playwright (E2E) |
| CI / supply chain | GitHub Actions (SHA-pinned), cargo-audit, cargo-deny, gitleaks, CodeQL, Dependabot |

## Project Layout

```
backend/
  src/
    main.rs          Entry point — logging, config, DB init, Discord, background runners
    lib.rs           Library crate: route table + re-exports
    config.rs        All config loaded from environment variables
    state.rs         Shared AppState (pool, config, caches, active-task sets)
    error.rs         AppError — single error type → HTTP status mapping
    middleware.rs    Request middleware (CORS, compression, rate limiting)
    validation.rs    Shared input-validation helpers (system-boundary checks)
    auth/            Google OAuth PKCE, JWT middleware, impersonation extractor
    db/              SQLite data access — one file per domain (see below)
    handlers/        Axum route handlers — one file per feature
    minecraft/       MC interaction over SSH/RCON + background runners
    discord/         Discord bot gateway + webhook bridge
    gcloud/          Legacy GCP helpers (being phased out — VPS is canonical)
  migrations/        SQLx SQLite migrations (0001–0044), auto-run on startup
  bindings/          Auto-generated TypeScript types (ts-rs)
  deny.toml          cargo-deny policy (sources/licenses/advisories/bans)
  rust-toolchain.toml Pinned Rust toolchain
  tests/             Integration tests (api.rs)

frontend/
  src/
    main.tsx         React entry point
    App.tsx          Root: providers, routing, age-gate + onboarding wizard
    api/client.ts    Fetch wrapper (auth, error envelope, X-Impersonate-As header)
    types/index.ts   TS types mirroring Rust structs
    store/auth.ts    Zustand stores (auth, theme, nav prefs, impersonation)
    hooks/           useAuth, useMetrics, useHotkeys, useFocusTrap
    components/       Shared UI (Layout, Toast, Badge, ConfirmDialog,
                      SegmentedControl, ImpersonationBanner, KillSwitchBanner,
                      PartyChipBar, RestartPendingChip, McItemImage, DiscIcon)
    features/         Self-contained feature modules (see below)
  e2e/               Playwright specs
  public/            Static assets
  .npmrc             npm hardening (ignore-scripts, pinned registry, save-exact)
  .nvmrc             Node 22

scripts/             Operational scripts (deploy, backup, world-switch, give-item, …)
infra/
  redstonecipher.service  Sandboxed systemd unit for the backend
  minecraft.service       systemd unit for PaperMC
  mc-watchdog/            Tailscale admission watchdog (player-watchdog.sh + watchdog.py)
  security/               Hardening scripts, nginx rate-limit, GitHub-security enabler
.github/
  workflows/         security-audit, release, secret-scan, codeql
  dependabot.yml     cargo + npm + github-actions update automation
.gitleaks.toml       Secret-scanning config
docs/                UX + reference docs
```

### Backend domains (`db/` + matching `handlers/`)

Core: `users`, `roles`, `permissions`, `prefs`, `settings`, `audit`, `worlds`,
`world_gamerules`, `backups`, `players`, `pending_players`, `player_snapshots`,
`map_pins`, `chat`, `music_queue`, `kill_switch`.

Events & gameplay: `lobbies`, `parties`, `countdowns`, `rising_oceans`,
`bounty_boards`, `music_zones`, `credits` (scrolling credits), `scheduled_jobs`.

Plugins: `plugins_catalog`, `installed_plugins`, `plugin_goals`,
`plugin_health`, `plugin_jobs` (Modrinth-backed).

### Background runners (`minecraft/`)

Long-lived Tokio tasks that drive in-game state: `chat_watcher`, `music`,
`music_zone_runner`, `countdown_runner`, `rising_oceans_runner`,
`bounty_runner`, `lobby_runner`, `credits_runner`, `pin_hud_runner`,
`scheduled_runner` (cron), `player_stats`, `plugin_health`, `plugin_updater`.
SSH/RCON plumbing: `console.rs`, `players.rs`, `dimensions.rs`, `world_switch.rs`.

### Frontend feature modules

`admin` (users/roles/permissions/pending players/worlds + **impersonation**),
`auth`, `dashboard` (status + metrics + **player stats**), `server-control`,
`configure`, `team` (+ party management), `players` (inventory/linking),
`chat`, `map`, `music` (queue + zones + credits), `events` (countdowns, rising
oceans, bounty boards, lobbies), `automations` (scheduled jobs),
`plugins` (Modrinth browse/install/update), `backups`, `onboarding`.

## Development

### Prerequisites
- Rust 1.88 (auto-selected by `rust-toolchain.toml`)
- Node 22 (`.nvmrc`)
- SQLite 3
- SSH access to both servers over Tailscale (for full integration testing)

### Running locally
```bash
cp .env.example .env          # fill in required values
cd backend && cargo run        # terminal 1 — backend on :8787
cd frontend && npm ci --ignore-scripts && npm run dev   # terminal 2
```
Vite dev server runs at `https://localhost:5173` and proxies `/api/*` and
`/auth/*` to the backend. Optional mkcert certs in `frontend/certs/`.

> Install note: `.npmrc` sets `ignore-scripts=true` as a supply-chain control.
> Always install with `npm ci --ignore-scripts`. If a dependency legitimately
> needs an install script, rebuild it narrowly (`npm rebuild <pkg>`) rather than
> re-enabling scripts globally.

### Testing
```bash
cd backend && cargo test                 # Rust unit/integration + regenerates ts-rs bindings
cd frontend && npm run typecheck         # tsc
cd frontend && npm run lint              # eslint
cd frontend && npm run analyze           # typecheck + lint + jscpd + type-coverage + knip
cd frontend && npx playwright test       # E2E (needs dev server)
```

### Building / deploying for production

Production artifacts are built in **CI** (`.github/workflows/release.yml`) from
the pinned toolchain and committed lockfiles, checksummed, SBOM'd, and
build-provenance-attested. The production host no longer compiles or pulls from
crates.io/npm at deploy time.

```bash
# Backend: fetch + checksum-verify the CI binary, atomic swap on the server
scripts/deploy-backend.sh            # (DEPLOY_BUILD_ON_SERVER=1 forces the legacy in-place build)

# Frontend: local build + deploy, OR verified CI artifact
scripts/deploy-frontend.sh           # fast local build
scripts/deploy-frontend.sh --from-ci # download + verify the attested dist
```

> Vite/rolldown caches transforms in `node_modules/.vite`. For a guaranteed
> clean rebuild use `rm -rf dist node_modules/.vite && npx vite build` — a stale
> cache can mask a JSX/TS error and silently re-emit the previous bundle.

All deploys go over rsync-over-SSH with keepalive — **never direct `scp`** from
local → VPS (it fails with exit 255 on untrusted connections).

## Key Concepts

### Permission model
Role-based with per-user overrides. System roles `visitor → global_admin`
(levels 0–4). Custom roles can be created below the creator's level. Permissions
are read from the DB on every request — changes take effect instantly.

### Admin impersonation ("View as")
Admins (level ≥ 3) can view the portal as another lower-level user via a
stateless per-request `X-Impersonate-As` header — the JWT never changes. The
`AuthUser` extractor exposes both the effective identity and the real one;
`audit_actor()` attributes every action as `real_email [acting as target]` in
both frontend and backend logs. Cannot self-impersonate or impersonate a
peer/superior. Surfaced via `ImpersonationBanner` + admin "View as" controls.

### World management
World slots in `/opt/minecraft/worlds/{slug}/`; the active world lives in
`/opt/minecraft/server/world*`. `world-switch.sh` over SSH: save → stop →
rsync out → rsync in → start → health check. The DB flag flips only on success.

### Events & gameplay systems
Countdowns, Rising Oceans, Bounty Boards, pre-game Lobbies, and Parties are
first-class targets, each driven by a background runner that issues in-game
commands. Lobbies can auto-start a linked event. Scrolling credits play via
title + tellraw. Music zones tie `/playsound` to map regions.

### Music queue
Vanilla `/playsound` over a FIFO console bridge; built-in disc tracks + custom
tracks from uploaded resource packs (UUID-renamed on upload). State broadcast
to clients via SSE; a Tokio task auto-advances the queue.

### Plugins (Modrinth)
Browse, install, and auto-update PaperMC plugins via the Modrinth API. Tracks
installed versions, health, and update jobs; jar install/swap over SSH.

### Player admission
The MC port is Tailscale-only. A watchdog on mc-server-1
(`mc-player-watchdog.service` → `player-watchdog.sh`, config in
`/etc/mc-watchdog.env`) detects first-time joins and registers them as pending;
admins approve/reject in the web UI. The shared `WATCHDOG_TOKEN` authenticates
the watchdog → backend `/internal/player-joined` call.

### Kill switch
A global kill switch can halt MC-affecting actions; surfaced via
`KillSwitchBanner` and enforced server-side.

### Discord bridge
Bidirectional chat: Serenity bot gateway (Discord→MC) + webhooks (MC→Discord).
Credentials stored AES-256-GCM-encrypted in the SQLite `app_settings` table.

## TypeScript bindings
`ts-rs` auto-generates type definitions in `backend/bindings/`, mirroring Rust
API structs. After changing backend response types, run `cargo test` to
regenerate them, then mirror into `frontend/src/types/` as needed.

## Database migrations
Plain SQL in `backend/migrations/` (currently 0001–0044), run automatically on
startup via SQLx. Add the next-numbered file; keep migrations idempotent-safe.

## Supply-chain security

The repo is hardened against dependency/build/credential attacks. When touching
dependencies or CI:

- **GitHub Actions are pinned to full commit SHAs** (version in a trailing
  comment). Never use mutable tags. Dependabot bumps the pins.
- **`backend/deny.toml`** enforces crates.io-only sources, a license allowlist,
  and yanked-deny. `cargo audit` gates CVEs. Keep its `[advisories].ignore` in
  sync with the `--ignore` flags in `security-audit.yml`.
- **Lockfiles are authoritative.** Build with `--locked` (Rust) and
  `npm ci --ignore-scripts` (Node). `lockfile-lint` guards registry tampering.
- **gitleaks** runs on every push + full history weekly; **never commit
  secrets** — config lives in env / `app_settings` (encrypted). Native push
  protection is unavailable on this private repo (no GHAS), so gitleaks is the
  active control.
- **Runtime sandbox:** `infra/redstonecipher.service` confines the backend
  (NoNewPrivileges, ProtectSystem=strict, syscall + address-family filters,
  MemoryDenyWriteExecute, scoped ReadWritePaths).

## Environment variables
See `.env.example` for the full list. Required: `DATABASE_URL`, `JWT_SECRET`
(64-char hex), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Notable optional:
`WATCHDOG_TOKEN`, `RESEND_API_KEY`, `TAILSCALE_*`. Discord and Modrinth
credentials and other runtime-changeable secrets live AES-256-GCM-encrypted in
the `app_settings` table (managed via the UI), not in env.

## Conventions
- Backend: single `AppError` (thiserror) → HTTP status; validate at boundaries
  (`validation.rs`); audit via `actor.audit_actor()` (impersonation-aware).
- Frontend: all API calls through `api/client.ts`; feature modules are
  self-contained; Tailwind + Radix; Zustand for client state, TanStack Query
  for server state; SSE for real-time (chat, music).
- Style: immutable updates (no mutation), small focused files, comprehensive
  error handling. See `~/.claude/rules/` for the global coding standards.
- Git: one request = one (or more) commit(s) + push; conventional-commit
  messages; commit only after the build/tests pass.

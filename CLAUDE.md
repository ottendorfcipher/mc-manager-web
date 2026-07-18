# redstoneCipher

A web portal for managing a private, invite-only Minecraft server. Role-based
access, a Rust backend that controls a PaperMC server over SSH, and a React
frontend. This file orients contributors and AI assistants. For deployment see
[docs/self-hosting.md](docs/self-hosting.md).

## Architecture

```
Browser -> nginx (serves the SPA, proxies /api + /auth) -> Rust/Axum backend -> SQLite (WAL)
                                                                  |
                                                              SSH + RCON
                                                                  |
                                                          PaperMC (mc host)
```

The backend is a single binary. It serves the API and controls the Minecraft
server by running `ssh` and `scp` against the mc host, using a key at
`/opt/redstonecipher/mc_ssh_key`. In Docker Compose the three pieces run as the
`web`, `backend`, and `mc` services, and the SSH key is generated on first run.

Auth is Google OAuth2 (PKCE), invite-only, with an optional Cloudflare Access
OIDC provider. Sessions are an HS256 JWT in an HttpOnly cookie named `__session`.
The database is SQLite at the path in `DATABASE_URL`, with migrations in
`backend/migrations/` applied automatically on startup.

## Tech stack

Backend: Rust 1.88 (pinned in `backend/rust-toolchain.toml`), Axum 0.7, SQLx
(SQLite), Tokio, Serenity for Discord. Frontend: React 19, TypeScript, Vite 8
(rolldown), TailwindCSS, Zustand, TanStack Query and Router, Radix UI, Leaflet.
Plugins come from the Modrinth API. Tests use `cargo test` (axum-test) and
Playwright.

## Project layout

```
backend/
  src/
    main.rs        Entry point: config, DB init, background runners, seeding
    lib.rs         Route table and re-exports
    config.rs      All config from environment variables
    state.rs       Shared AppState
    error.rs       AppError to HTTP status mapping
    auth/          OAuth providers (google.rs, cloudflare.rs), JWT middleware
    db/            SQLite access, one file per domain
    handlers/      Axum handlers, one file per feature
    minecraft/     SSH and RCON control plus background runners
    discord/       Discord bot gateway and webhook bridge
  migrations/      SQL migrations, applied on startup
  bindings/        ts-rs generated TypeScript types
frontend/
  src/
    features/      Self-contained feature modules
    api/client.ts  Fetch wrapper (auth, error envelope, impersonation header)
    store/auth.ts  Zustand stores
scripts/           Operational scripts run on the mc host over SSH
infra/             systemd units, watchdog, hardening (reference for bare-metal)
docker/            Dockerfiles and entrypoints for the mc image and nginx
```

### Backend domains

Core: users, roles, permissions, prefs, settings, audit, worlds, world gamerules,
backups, players, pending players, player snapshots, map pins, chat, music queue,
kill switch. Events: lobbies, parties, countdowns, rising oceans, bounty boards,
music zones, credits, scheduled jobs. Plugins: catalog, installed, goals, health,
jobs (Modrinth backed).

### Background runners

Long-lived Tokio tasks drive in-game state: chat watcher, music and music zones,
countdowns, rising oceans, bounties, lobbies, scrolling credits, pin HUD,
scheduled jobs (cron), player stats, plugin health, and the plugin updater. SSH
and RCON plumbing lives in `console.rs`, `players.rs`, `dimensions.rs`, and
`world_switch.rs`.

## Key concepts

Permission model. Roles are integer levels from visitor (0) to global_admin (4),
with per-user overrides. Permissions are string keys read from the database on
every request, so changes take effect immediately. The first global_admin is
seeded at startup from `BOOTSTRAP_ADMIN_EMAIL`.

Admin impersonation. An admin can view the portal as a lower-privileged user
through a per-request `X-Impersonate-As` header. The JWT never changes, and the
audit log attributes actions to the real admin acting as the target.

Player admission. The vanilla whitelist plus a watchdog on the mc host gate who
can play. First-time joins register as pending, and admins approve or reject them
in the web UI. A shared `WATCHDOG_TOKEN` authenticates the watchdog call.

Discord bridge. A Serenity bot forwards Discord to Minecraft, and webhooks forward
Minecraft to Discord. Credentials are stored encrypted in the database.

## Configuration

All config comes from environment variables. See `.env.example` for the full
list. Required: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. First admin: `BOOTSTRAP_ADMIN_EMAIL`. Site and cookies:
`SITE_URL`, `REDIRECT_URI`, `CORS_ORIGINS`, `COOKIE_SECURE`. Cloudflare login:
`CLOUDFLARE_TEAM_DOMAIN`, `CLOUDFLARE_CLIENT_ID`, `CLOUDFLARE_CLIENT_SECRET`.
Optional integrations (Resend email, Tailscale invites) are also there. Discord
and Modrinth credentials live encrypted in the database, not in the environment.

## TypeScript bindings

`ts-rs` generates type definitions in `backend/bindings/`. After changing a
backend response type, run `cargo test` to regenerate them, then mirror the
change into `frontend/src/types/` where needed.

## Conventions

Backend uses a single `AppError`, validates input at boundaries, and audits
through an impersonation-aware actor. Frontend routes every call through
`api/client.ts`, keeps feature modules self-contained, uses Zustand for client
state and TanStack Query for server state, and SSE for real-time chat and music.
Prefer immutable updates, small focused files, and clear error handling. Keep
docs free of em dashes.

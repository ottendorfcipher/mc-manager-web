# redstoneCipher

A web portal for running a private, invite-only Minecraft server. It gives your
group one place to control the server, watch a live map, manage players and
roles, run events, play music, install plugins, and bridge chat with Discord.

Built with Rust (Axum) and React (TypeScript), backed by SQLite. The backend
controls a PaperMC server over SSH.

## Quick start with Docker

You need Docker with Compose, and a Google OAuth client (about five minutes to
create). See [docs/self-hosting.md](docs/self-hosting.md) for the OAuth steps and
everything below in more detail.

```bash
cp .env.example .env
# Edit .env and set at least:
#   JWT_SECRET               (openssl rand -hex 32)
#   GOOGLE_CLIENT_ID/SECRET  (from the Google Cloud Console)
#   BOOTSTRAP_ADMIN_EMAIL    (your Google address; becomes the first admin)
#   SITE_URL=http://localhost:8080
#   REDIRECT_URI=http://localhost:8080/auth/callback
#   COOKIE_SECURE=false
docker compose up --build
```

Open http://localhost:8080 and sign in with the admin Google account. The stack
runs three containers: the web frontend, the Rust backend, and a PaperMC server
that the backend manages over SSH. Keys are generated on first run, so there is
no manual SSH setup.

## Sign-in

Sign-in is Google OAuth by default, and access is invite-only. The first login
by `BOOTSTRAP_ADMIN_EMAIL` becomes the global admin, who then invites others by
email. You can also enable a "Sign in with Cloudflare" button through Cloudflare
Access. Both are covered in [docs/self-hosting.md](docs/self-hosting.md).

## What you can do

Server control (start, stop, switch worlds, tune gamerules), a live Leaflet map,
player and role management with per-user permission overrides, events
(countdowns, bounties, lobbies, parties), a music queue over in-game sounds,
one-click PaperMC plugin installs from Modrinth, a bidirectional Discord chat
bridge, and backups. An admin can also view the portal as any lower-privileged
user to debug what they see.

## Local development

For working on the code without Docker, run the two dev servers directly.

```bash
cp .env.example .env          # fill in the required values
cd backend  && cargo run      # backend on :8787
cd frontend && npm ci --ignore-scripts && npm run dev
```

The Vite dev server runs on https://localhost:5173 and proxies API and auth
routes to the backend. [CONTRIBUTING.md](CONTRIBUTING.md) has the test commands,
and [CLAUDE.md](CLAUDE.md) is a fuller architecture tour.

## Documentation

- [docs/self-hosting.md](docs/self-hosting.md): full deployment guide, OAuth
  setup, Cloudflare login, going to production, and backups.
- [CONTRIBUTING.md](CONTRIBUTING.md): local setup, tests, and pull requests.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.

## Tech stack

Rust 1.88, Axum, SQLx, and Tokio on the backend. React 19, TypeScript, Vite,
TailwindCSS, Zustand, and TanStack Query on the frontend. PaperMC for the game
server, nginx and Docker for delivery.

## License

MIT. See [LICENSE](LICENSE).

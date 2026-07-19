# redstoneCipher

A private web dashboard for a Minecraft server you and your friends run together.

Instead of handing out server passwords or typing console commands, everyone
signs in with their Google account and runs the server from a web page: who is
allowed to play, what the world is doing, backups, music, events, and chat.

It is invite only by design. You decide who gets in, and what each person can do.

## What you can do

Start and stop the server, switch between worlds, and change game rules without
opening a console. Watch players move on a live map. Approve new players and give
each person exactly the permissions you want. Run in-game events like countdowns
and bounties. Queue music. Install plugins in one click. Bridge chat between the
game and Discord. Take and restore backups.

## Start here

One command sets everything up and walks you through it:

```bash
./start-here.sh
```

It checks what you need, asks a few questions, saves your settings, and starts
everything with a progress bar. Expect about ten minutes the first time, mostly
waiting on downloads. When it finishes, open the address it prints and sign in.

Rather do it by hand? Copy `.env.example` to `.env`, fill it in, then run
`docker compose --profile local up -d --build`. The
[self-hosting guide](docs/self-hosting.md) explains every setting.

## What you need

Docker with Compose, and a Google account. Setup walks you through creating a
Google sign-in app and pasting two values from it, which takes about five minutes
and costs nothing. Everything else runs on your machine or your own server.

## How it works

Three pieces run together. Your browser opens a web page, that page talks to a
small control server, and the control server talks to Minecraft.

The control server drives Minecraft the same way a human admin would, by sending
console commands over a secure connection. Nothing about how Minecraft itself
runs has to change. That is why you can point this at the Minecraft server
bundled here, or at one you already run somewhere else.

If you want the technical version: the backend is a single Rust binary (Axum)
keeping state in SQLite, the frontend is a React single-page app served by nginx,
and the backend reaches the game host over SSH, using RCON and a console pipe for
in-game commands. It ships as three containers.

## Signing in

Sign-in uses Google, and the site is invite only. The first person to sign in
with the admin email you configure becomes the owner, and everyone after that has
to be invited. You can optionally add a "Sign in with Cloudflare" button as a
second method.

## Bundled server, or your own

By default you get a managed Minecraft server in a container, ready to play. If
you already run a server, choose the remote option during setup and give it the
address instead. Setup generates the access key and tells you the one line to add
on your server. Both paths are in the [self-hosting guide](docs/self-hosting.md).

## For developers

```bash
cp .env.example .env
cd backend  && cargo run                                # API on :8787
cd frontend && npm ci --ignore-scripts && npm run dev   # UI on :5173
```

Rust 1.88 with Axum, SQLx, and Tokio on the backend. React 19 with TypeScript,
Vite, Tailwind, Zustand, and TanStack Query on the frontend. PaperMC for the game
server. Test commands and conventions live in [CONTRIBUTING.md](CONTRIBUTING.md),
and [CLAUDE.md](CLAUDE.md) is a deeper tour of the architecture.

## Documentation

[Self-hosting guide](docs/self-hosting.md) covers deployment, sign-in setup,
going to production, and backups. [Contributing](CONTRIBUTING.md) covers local
setup and tests. [Security](SECURITY.md) explains how to report a vulnerability.

## License

MIT. See [LICENSE](LICENSE).

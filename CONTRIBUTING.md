# Contributing

Thanks for your interest in improving redstoneCipher. This guide covers the
basics of working in the codebase.

## Prerequisites

You need Rust (the version is pinned in `backend/rust-toolchain.toml`), Node 22
(see `frontend/.nvmrc`), and SQLite 3. `CLAUDE.md` has a fuller tour of the
architecture.

## Local setup

Copy `.env.example` to `.env` and fill in the required values. Then run the
backend and frontend in separate terminals.

```bash
cp .env.example .env
cd backend && cargo run          # backend on :8787
cd frontend && npm ci --ignore-scripts && npm run dev
```

Install frontend dependencies with `--ignore-scripts`. It is a supply-chain
guard set in `.npmrc`. If one package genuinely needs its install script, rebuild
just that package with `npm rebuild <pkg>`.

## Tests and checks

Run these before opening a pull request.

```bash
cd backend  && cargo test --locked
cd frontend && npm run typecheck && npm run lint && npx vite build
```

`cargo test` also regenerates the TypeScript bindings in `backend/bindings/`. If
they change, mirror the update into `frontend/src/types/` and commit it.

## Pull requests

Keep each pull request focused on one change. Write a clear title and a short
description of what changed and why. Use Conventional Commit prefixes such as
`feat:`, `fix:`, `docs:`, or `refactor:` in commit messages.

Do not commit secrets. Configuration belongs in `.env` (git-ignored) or, for
runtime-changeable values, in the encrypted settings table.

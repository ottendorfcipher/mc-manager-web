# redstoneCipher — Web Edition

A PWA for managing your GCP Minecraft server. Built with Rust (Axum), React (TypeScript), and SQLite.

## Quick Start

### Prerequisites
- Rust 1.80+ (`rustup update`)
- Node 22+ (`node --version`)
- gcloud CLI authenticated (`gcloud auth login`)

### 1. Configure
```bash
cp .env.example .env
# Edit .env — fill in JWT_SECRET and Google OAuth credentials
openssl rand -hex 32   # use this as JWT_SECRET
```

**Google OAuth setup (one-time, free):**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create → OAuth 2.0 Client ID → Web application
3. Add `https://redstonecipher.com/auth/callback` as an authorized redirect URI (for production) or `http://localhost:8787/auth/callback` (for local dev)
4. Copy Client ID and Client Secret into `.env`

### 2. Migrate existing data
```bash
chmod +x migrate.sh
./migrate.sh
```
This imports your existing users, player links, preferences, and backup metadata from the Python app.

### 3. Run (development)
```bash
# Terminal 1 — Rust backend
cd backend && cargo run

# Terminal 2 — React frontend with hot reload
cd frontend && npm run dev
```
Open http://localhost:5173 — API calls are proxied to :8787.

### 4. Run (production single binary)
```bash
cd frontend && npm run build   # outputs to backend/dist/
cd backend  && cargo build --release
./target/release/redstonecipher-server
```
Open http://localhost:8787

## Testing
```bash
# Rust unit tests
cd backend && cargo test

# Playwright E2E tests (requires npm run dev running)
cd frontend && npx playwright test
```

## Project Structure
```
backend/    Rust Axum server — API, auth, gcloud integration
frontend/   React + TypeScript PWA
migrate.sh  One-shot migration from Python app
.env.example  Configuration template
```

## Architecture
- **Single binary**: `cargo build --release` produces one executable that serves both the API and the compiled React frontend.
- **SQLite**: Zero-infrastructure database. WAL mode, foreign keys enforced.
- **Google OAuth2 PKCE**: Free authentication. No server-side secrets needed beyond the client credentials.
- **GCP IAP SSH**: All VM operations go through the existing gcloud IAP tunnel — no additional cost.
- **FIFO console**: Minecraft commands sent via the named pipe created by the systemd service.

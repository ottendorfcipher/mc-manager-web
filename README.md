# redstoneCipher — Web Edition

A PWA for managing your GCP Minecraft server. Built with Rust (Axum), React (TypeScript), and SQLite.

## Architecture

- **`redstonecipher.com`** → Cloud Run (domain mapping, TLS managed by Google)
- **Cloud Run** (`us-central1`, 1 instance): single Rust binary serving the React SPA + all API endpoints
- **SQLite + Litestream**: WAL-mode database replicated continuously to GCS (`redstonecipher-web-data` bucket)
- **Google OAuth2 PKCE**: email-allowlist auth — admins invite users by email; invited users sign in with their Google account
- **Tailscale** (outbound only): the container joins the tailnet so `gcloud compute ssh --tunnel-through-iap` can reach the Minecraft VM in `minecraft-493201`
- **GCP IAP SSH**: all VM start/stop/console operations tunnel through IAP — no public SSH port needed
- **Pub/Sub + Cloud Billing budget ($25/month across both GCP projects)**: at 100%, the push subscription hits `POST /internal/budget-alert` and the in-app kill-switch engages
- **Cloud Function backstop** (`infra/budget-kill-switch/`): scales Cloud Run to zero even if the in-app webhook is unreachable

## Quick Start

### Prerequisites
- Rust 1.88+ (`rustup update`)
- Node 22+ (`node --version`)
- gcloud CLI authenticated (`gcloud auth login`)

### 1. Configure
```bash
cp .env.example .env
# Edit .env — fill in JWT_SECRET and Google OAuth credentials
openssl rand -hex 32   # use this as JWT_SECRET
```

**Google OAuth setup (one-time):**
1. [GCP Console](https://console.cloud.google.com) → APIs & Services → Credentials
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
Open http://localhost:5173 — API calls are proxied to `:8787`.

### 3. Run (production single binary)
```bash
cd frontend && npm run build   # outputs to backend/dist/
cd backend  && cargo build --release
./target/release/redstonecipher-server
```

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

Every push to `main` triggers Cloud Build (`cloudbuild.yaml`):
1. Builds the multi-stage Docker image (Node 22 frontend → Rust 1.88 backend → debian:bookworm-slim runtime)
2. Pushes to Artifact Registry
3. Deploys to Cloud Run with secrets from Secret Manager

For a first-time full infrastructure bootstrap:
```bash
export BILLING_ACCOUNT=XXXX-XXXX-XXXX
export JWT_SECRET=$(openssl rand -hex 32)
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
export BUDGET_WEBHOOK_TOKEN=$(openssl rand -hex 32)
export TS_AUTHKEY=...   # Tailscale reusable+ephemeral key (for outbound SSH to MC VM)
bash infra/setup.sh
```

## Project Structure
```
backend/              Rust Axum server — API, auth, gcloud/MC integration
  migrations/         SQLite schema migrations (sqlx)
  src/
    auth/             Google OAuth PKCE + JWT middleware
    db/               SQLite access layer (users, players, kill-switch, etc.)
    handlers/         Axum route handlers
    minecraft/        SSH console + backup + player management
    gcloud/           VM start/stop via IAP
frontend/             React + TypeScript SPA
  src/
    features/         Page-level components (dashboard, server, team, admin)
    components/       Shared UI (Layout, KillSwitchBanner, Badge)
  e2e/                Playwright tests
infra/
  setup.sh            Idempotent full infrastructure bootstrap
  budget-kill-switch/ Cloud Function hard-backstop (scales CR to 0)
scripts/
  security-check.sh   Local SAST sweep (cargo audit, clippy, npm audit, semgrep)
  setup-budget.sh     Legacy budget helper (see infra/setup.sh for current approach)
docs/
  budget-cap.md       Kill-switch architecture and testing guide
Dockerfile            Multi-stage image (Node + Rust + gcloud + Litestream + Tailscale)
entrypoint.sh         Container boot: Tailscale → DB restore → server
cloudbuild.yaml       CI/CD pipeline
```

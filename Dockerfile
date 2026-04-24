# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
# vite.config.ts outputs to ../backend/dist
RUN npm run build

# ─── Stage 2: Build Rust backend ─────────────────────────────────────────────
# 1.88 is the minimum required by transitive deps: time v0.3.47, icu v2.2.0
FROM rust:1.88-slim AS backend-build
WORKDIR /app/backend

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependency compilation separately from source changes
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release 2>/dev/null; rm -rf src

# Now copy the real source and migrations, plus the compiled frontend dist
COPY backend/ ./
COPY --from=frontend-build /app/backend/dist ./dist

# Touch main.rs so cargo knows to relink
RUN touch src/main.rs && cargo build --release

# ─── Stage 3: Runtime image ───────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
#   - ca-certificates, curl, gnupg, apt-transport-https: shared prereqs
#   - google-cloud-cli: gcloud/IAP-SSH for managing the MC Compute VM
#   - tailscale: WireGuard-based VPN; the container joins your tailnet so
#                that the web portal is only reachable from inside Tailscale
RUN apt-get update && apt-get install -y \
      ca-certificates \
      curl \
      gnupg \
      apt-transport-https \
    # ── gcloud ────────────────────────────────────────────────────────────
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] \
              https://packages.cloud.google.com/apt cloud-sdk main" \
       | tee /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
       | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update && apt-get install -y google-cloud-cli \
    # ── tailscale ─────────────────────────────────────────────────────────
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.gpg \
       | gpg --dearmor -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] \
              https://pkgs.tailscale.com/stable/debian bookworm main" \
       | tee /etc/apt/sources.list.d/tailscale.list \
    && apt-get update && apt-get install -y tailscale \
    && rm -rf /var/lib/apt/lists/*

# Runtime directories for tailscaled state and socket
RUN mkdir -p /var/run/tailscale /var/lib/tailscale

# Install Litestream (SQLite → GCS continuous replication)
ARG LITESTREAM_VERSION=v0.3.13
RUN curl -fsSL \
      "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /usr/local/bin litestream

WORKDIR /app

COPY --from=backend-build /app/backend/target/release/redstonecipher-server ./
COPY --from=backend-build /app/backend/dist ./dist

COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Persistent data directory (SQLite DB + backups)
RUN mkdir -p /data/backups

# ── Environment defaults ───────────────────────────────────────────────────────
# PORT is injected by Cloud Run automatically; the value here is for local runs only.
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_URL=sqlite:///data/mc-manager.db \
    BACKUP_DIR=/data/backups \
    GCLOUD_BIN=/usr/bin/gcloud \
    CLOUDSDK_CONFIG=/tmp/gcloud-config \
    GCP_PROJECT=minecraft-493201 \
    GCP_ZONE=us-central1-a \
    GCP_INSTANCE=mc-server-spot \
    TAILSCALE_IP=100.80.114.91 \
    REDIRECT_URI=https://redstonecipher-web.CHANGE_ME.ts.net/auth/callback

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]

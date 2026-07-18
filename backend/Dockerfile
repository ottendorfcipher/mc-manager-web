# syntax=docker/dockerfile:1

# ── Build the Rust backend ────────────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/ ./backend/
WORKDIR /app/backend
RUN cargo build --release --locked

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
# The backend controls the Minecraft server over SSH and processes uploaded
# audio, so it needs an ssh client, rsync, and ffmpeg at runtime. netcat lets
# the entrypoint wait for the mc container's sshd before starting.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client rsync ffmpeg ca-certificates libssl3 netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/backend/target/release/redstonecipher-server /usr/local/bin/redstonecipher-server
COPY docker/backend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /opt/redstonecipher
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

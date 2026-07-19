# syntax=docker/dockerfile:1

# ── Build the Rust backend ────────────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/ ./backend/
WORKDIR /app/backend
# The release profile uses fat LTO + a single codegen unit, which needs a lot of
# RAM to link and OOM-kills on small build machines. Disable LTO and parallelize
# codegen for the Docker build so it succeeds on modest hardware; the runtime
# difference is negligible for this I/O-bound server, and the CI production build
# still uses full LTO.
ENV CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
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

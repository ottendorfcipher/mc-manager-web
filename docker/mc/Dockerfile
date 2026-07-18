# syntax=docker/dockerfile:1
# The Minecraft server the backend controls over SSH. It reproduces the
# /opt/minecraft layout the backend expects (server dir, console.fifo, scripts).
FROM eclipse-temurin:21-jre-jammy

# Tools the backend and its scripts invoke over SSH on this host.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server rsync curl python3 ca-certificates gcc make \
    && rm -rf /var/lib/apt/lists/*

# mcrcon: the backup and world-switch scripts use it to flush the world safely.
RUN curl -fsSL https://github.com/Tiiffi/mcrcon/archive/refs/tags/v0.7.2.tar.gz -o /tmp/mcrcon.tgz \
    && tar -xzf /tmp/mcrcon.tgz -C /tmp \
    && make -C /tmp/mcrcon-0.7.2 \
    && cp /tmp/mcrcon-0.7.2/mcrcon /usr/local/bin/ \
    && rm -rf /tmp/mcrcon*

# The exact layout the backend addresses over SSH.
RUN mkdir -p /opt/minecraft/server /opt/minecraft/scripts /opt/minecraft/worlds /opt/minecraft/backups
COPY scripts/ /opt/minecraft/scripts/
COPY docker/mc/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && find /opt/minecraft/scripts -name '*.sh' -exec chmod +x {} +

# 22 is internal (backend control); 25565 is the game port.
EXPOSE 22 25565
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

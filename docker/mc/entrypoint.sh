#!/usr/bin/env bash
# mc container entrypoint. Installs the backend's SSH key, starts sshd, then
# provisions and runs PaperMC with a console pipe the backend writes commands to.
set -euo pipefail

MC=/opt/minecraft
SRV=$MC/server
FIFO=$MC/console.fifo

# 1. Accept the backend's control key (shared via the keys volume).
mkdir -p /root/.ssh /run/sshd
echo "[mc] waiting for the backend public key"
until [ -f /keys/backend.pub ]; do sleep 1; done
cat /keys/backend.pub > /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
ssh-keygen -A
/usr/sbin/sshd
echo "[mc] sshd started"

# 2. Download PaperMC once (latest stable build via the v3 Fill API).
PAPER_VERSION="${PAPER_VERSION:-1.21.11}"
UA="redstoneCipher/1.0 (self-hosted Minecraft manager)"
if [ ! -f "$SRV/server.jar" ]; then
  echo "[mc] downloading PaperMC $PAPER_VERSION"
  URL=$(curl -fsSL -H "User-Agent: $UA" \
      "https://fill.papermc.io/v3/projects/paper/versions/$PAPER_VERSION/builds" \
    | python3 -c '
import sys, json
data = json.load(sys.stdin)
builds = data["builds"] if isinstance(data, dict) and "builds" in data else data
stable = [b for b in builds if b.get("channel") == "STABLE"] or builds
best = max(stable, key=lambda b: b["id"])
print(best["downloads"]["server:default"]["url"])
')
  curl -fsSL -H "User-Agent: $UA" -o "$SRV/server.jar" "$URL"
fi

# 3. First-run configuration.
echo "eula=true" > "$SRV/eula.txt"
if [ ! -f "$MC/.rcon-password" ]; then
  head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$MC/.rcon-password"
fi
RCON_PW="$(cat "$MC/.rcon-password")"
if [ ! -f "$SRV/server.properties" ]; then
  cat > "$SRV/server.properties" <<EOF
server-port=25565
enable-rcon=true
rcon.port=25575
rcon.password=$RCON_PW
white-list=true
online-mode=true
motd=redstoneCipher
EOF
fi

# 4. Console bridge: the backend writes commands into console.fifo over SSH. We
#    open the fifo read-write on fd 3 (so it never sees EOF) and give it to the
#    server as stdin, so each line written becomes a console command. This is
#    more reliable than piping `tail`, which block-buffers small writes and never
#    flushes them to the server.
[ -p "$FIFO" ] || { rm -f "$FIFO"; mkfifo "$FIFO"; }

cd "$SRV"
echo "[mc] starting PaperMC"
exec 3<>"$FIFO"
exec java -Xms1G -Xmx"${MC_MAX_MEMORY:-2G}" -jar server.jar --nogui <&3

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

# 2. Download PaperMC once (latest build for the pinned version).
PAPER_VERSION="${PAPER_VERSION:-1.21.11}"
if [ ! -f "$SRV/server.jar" ]; then
  echo "[mc] downloading PaperMC $PAPER_VERSION"
  BUILD=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/$PAPER_VERSION/builds" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["builds"][-1]["build"])')
  JAR="paper-$PAPER_VERSION-$BUILD.jar"
  curl -fsSL -o "$SRV/server.jar" \
    "https://api.papermc.io/v2/projects/paper/versions/$PAPER_VERSION/builds/$BUILD/downloads/$JAR"
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

# 4. Console bridge: the backend writes commands into console.fifo over SSH, and
#    we feed them to the server's stdin. A held-open writer stops tail from
#    seeing EOF between commands.
[ -p "$FIFO" ] || { rm -f "$FIFO"; mkfifo "$FIFO"; }
( sleep infinity > "$FIFO" ) &

cd "$SRV"
echo "[mc] starting PaperMC"
tail -f "$FIFO" | java -Xms1G -Xmx"${MC_MAX_MEMORY:-2G}" -jar server.jar --nogui

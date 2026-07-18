#!/usr/bin/env bash
# Interactively update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the web server.
# Values are passed via stdin to avoid shell escaping issues with special characters.
set -euo pipefail

SERVER="root@your-web-server"
ENV_FILE="/opt/redstonecipher/.env"

echo ""
echo "=== RedstoneCipher OAuth Credential Updater ==="
echo "Values are sent securely and never echoed to the terminal."
echo ""

read -rp "Paste GOOGLE_CLIENT_ID: " CLIENT_ID
read -rsp "Paste GOOGLE_CLIENT_SECRET (hidden): " CLIENT_SECRET
echo ""

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "ERROR: Both values are required. Aborting."
  exit 1
fi

echo "Updating credentials on $SERVER..."

ssh "$SERVER" "python3 -c \"
import sys

env_path = '$ENV_FILE'
client_id = sys.stdin.readline().rstrip('\n')
client_secret = sys.stdin.readline().rstrip('\n')

with open(env_path) as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if line.startswith('GOOGLE_CLIENT_ID='):
        line = 'GOOGLE_CLIENT_ID=' + client_id + '\n'
    elif line.startswith('GOOGLE_CLIENT_SECRET='):
        line = 'GOOGLE_CLIENT_SECRET=' + client_secret + '\n'
    new_lines.append(line)

with open(env_path, 'w') as f:
    f.writelines(new_lines)

print('Credentials updated.')
\"" <<EOF
$CLIENT_ID
$CLIENT_SECRET
EOF

echo "Restarting service..."
ssh "$SERVER" "systemctl restart redstonecipher && sleep 2 && systemctl is-active redstonecipher"
echo "Done. Try logging in at https://your-domain.com"

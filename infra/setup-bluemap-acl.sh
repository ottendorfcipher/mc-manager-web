#!/usr/bin/env bash
# setup-bluemap-acl.sh
# Run once (as root) on the web server to grant the redstonecipher service
# user permanent write access to the BlueMap tiles directory.
#
# Problem: BlueMap (Minecraft plugin) and rsync jobs recreate maps/*/live/
# with root ownership, causing the service to receive EACCES when writing
# live/players.json (the per-dimension player position markers).
#
# Solution: setfacl default ACLs propagate to every new file and directory
# created anywhere under the map tree, regardless of which user/process
# creates them.  No cron job, no chown loop needed.
#
# Apply:  bash infra/setup-bluemap-acl.sh
# Re-run: safe to run multiple times (idempotent).

set -euo pipefail

MAP_DIR=/opt/redstonecipher/www/map
SERVICE_USER=redstonecipher

echo "Applying ACLs to $MAP_DIR ..."

# Current files and directories
setfacl -R -m "u:${SERVICE_USER}:rwx" "$MAP_DIR"

# Default ACLs — inherited by all future files and directories created here
setfacl -R -d -m "u:${SERVICE_USER}:rwx" "$MAP_DIR"

echo "Verifying ..."
getfacl "$MAP_DIR" | grep -E "user:|default"

echo "Done. The ${SERVICE_USER} user now has permanent write access to ${MAP_DIR}."

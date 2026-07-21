#!/usr/bin/env python3
"""
mc-watchdog  —  Minecraft Tailscale admission watchdog.

Tails the Minecraft server log, detects player join events, and calls the
redstonecipher backend to determine whether each player should be allowed,
kicked (pending approval), or kicked with a rejection notice.

Decision → FIFO command:
  allow  → no-op (player stays connected)
  kick   → kick <ign> <pending-message>
  ban    → kick <ign> <rejection-message>

Environment variables (all optional except WATCHDOG_TOKEN):
  BACKEND_URL    https://your-domain.com
  WATCHDOG_TOKEN shared secret matching WATCHDOG_TOKEN on the backend
  MC_LOG_PATH    /opt/minecraft/server/logs/latest.log
  MC_FIFO_PATH   /opt/minecraft/console.fifo
"""

import json
import logging
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

# ── Configuration ──────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("BACKEND_URL", "https://your-domain.com").rstrip("/")
TOKEN       = os.environ.get("WATCHDOG_TOKEN", "")
LOG_PATH    = os.environ.get("MC_LOG_PATH",  "/opt/minecraft/server/logs/latest.log")
FIFO_PATH   = os.environ.get("MC_FIFO_PATH", "/opt/minecraft/console.fifo")

# Minecraft log patterns (Paper 1.21+)
# [HH:MM:SS INFO]: UUID of player ChaoticLuc is 550e8400-e29b-41d4-a716-446655440000
UUID_RE = re.compile(r"UUID of player (\w+) is ([0-9a-f-]{36})", re.IGNORECASE)
# [HH:MM:SS INFO]: ChaoticLuc joined the game
JOIN_RE = re.compile(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) joined the game")

# Kick messages
MSG_PENDING = (
    "You are not yet approved to play here. "
    "Ask a server admin to approve your account at your-domain.com."
)
MSG_DENIED = (
    "Your access has been denied. "
    "Contact a server admin at your-domain.com if you think this is wrong."
)

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [mc-watchdog] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("mc-watchdog")

# ── State ─────────────────────────────────────────────────────────────────────

# Maps ign.lower() -> uuid string for recently seen players.
uuid_cache: dict = {}

# ── Helpers ────────────────────────────────────────────────────────────────────

def send_fifo(cmd: str) -> None:
    """Write one console command to the Minecraft FIFO pipe."""
    try:
        with open(FIFO_PATH, "w") as fh:
            fh.write(cmd + "\n")
        log.info("FIFO ← %s", cmd)
    except OSError as exc:
        log.warning("FIFO write failed (%s): %s", FIFO_PATH, exc)


def call_backend(ign: str, uuid) -> str:
    """
    POST /internal/player-joined → returns action string.
    Falls back to 'allow' on any network / server error so a backend outage
    does not lock every player out of the server.
    """
    if not TOKEN:
        log.warning("WATCHDOG_TOKEN is not set — allowing %s by default", ign)
        return "allow"

    payload = {"ign": ign}
    if uuid:
        payload["uuid"] = uuid

    req = urllib.request.Request(
        f"{BACKEND_URL}/internal/player-joined",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
            action = body.get("action", "allow")
            log.info("backend: player=%s action=%s", ign, action)
            return action
    except urllib.error.HTTPError as exc:
        log.error("Backend HTTP %s for %s: %s", exc.code, ign, exc.read())
        # Fail closed on auth failures: a 401/403 means the watchdog and backend
        # disagree on the shared token, so admitting the player would bypass the
        # admission gate entirely. Other errors keep the fail-open availability
        # tradeoff.
        if exc.code in (401, 403):
            return "kick"
        return "allow"
    except Exception as exc:
        log.error("Backend unreachable for %s: %s — defaulting to allow", ign, exc)
        return "allow"


def handle_join(ign: str) -> None:
    """Evaluate a join event and enforce the action returned by the backend."""
    uuid = uuid_cache.get(ign.lower())
    action = call_backend(ign, uuid)

    if action == "kick":
        send_fifo(f"kick {ign} {MSG_PENDING}")
    elif action == "ban":
        send_fifo(f"kick {ign} {MSG_DENIED}")
    # action == "allow" → no-op


# ── Main loop ─────────────────────────────────────────────────────────────────

def tail_log() -> None:
    """Tail latest.log forever, processing join/UUID events."""
    # Wait for the log to appear (server may not yet be running).
    while not os.path.exists(LOG_PATH):
        log.info("Waiting for log file: %s", LOG_PATH)
        time.sleep(5)

    log.info("Tailing %s", LOG_PATH)
    proc = subprocess.Popen(
        ["tail", "-F", "-n", "0", LOG_PATH],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()

        # Capture UUID before the join event so we can include it in the API call.
        m = UUID_RE.search(line)
        if m:
            uuid_cache[m.group(1).lower()] = m.group(2)
            continue

        m = JOIN_RE.search(line)
        if m:
            ign = m.group(1)
            log.info("Join detected: %s", ign)
            handle_join(ign)


if __name__ == "__main__":
    log.info("mc-watchdog starting (backend=%s, log=%s)", BACKEND_URL, LOG_PATH)
    if not TOKEN:
        log.warning(
            "WATCHDOG_TOKEN is empty — all join decisions will default to 'allow'. "
            "Set WATCHDOG_TOKEN in /etc/mc-watchdog.env to enable enforcement."
        )
    while True:
        try:
            tail_log()
        except Exception as exc:
            log.error("tail_log crashed: %s — restarting in 5 s", exc)
            time.sleep(5)

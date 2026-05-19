#!/usr/bin/env python3
"""
coord-display.py — read or toggle the Coords HUD tag (ch_on) in a player's NBT.

Usage:
  python3 coord-display.py get <uuid>            → prints "true" or "false"
  python3 coord-display.py set <uuid> true|false  → sets ch_on tag, prints "ok"

Works on offline playerdata files.  For online players the backend uses the
FIFO /tag command instead (which takes effect instantly without editing the file).
"""

import sys, os

try:
    import nbtlib
except ImportError:
    print("ERROR: nbtlib not installed", file=sys.stderr)
    sys.exit(1)

WORLD_DIR       = "/opt/minecraft/server/world"
PLAYERDATA_DIR  = os.path.join(WORLD_DIR, "playerdata")
TAG_NAME        = "ch_on"

def playerdata_path(uuid: str) -> str:
    return os.path.join(PLAYERDATA_DIR, f"{uuid}.dat")

def get_status(uuid: str) -> bool:
    path = playerdata_path(uuid)
    if not os.path.exists(path):
        print(f"ERROR: no playerdata for {uuid}", file=sys.stderr)
        sys.exit(1)
    nbt  = nbtlib.load(path)
    root = nbt.get("", nbt)
    tags = root.get("Tags", nbtlib.List[nbtlib.String]())
    return TAG_NAME in [str(t) for t in tags]

def set_status(uuid: str, enabled: bool) -> None:
    path = playerdata_path(uuid)
    if not os.path.exists(path):
        print(f"ERROR: no playerdata for {uuid}", file=sys.stderr)
        sys.exit(1)
    nbt  = nbtlib.load(path)
    root = nbt.get("", nbt)

    tags = root.get("Tags", nbtlib.List[nbtlib.String]())
    # Re-wrap as String list if empty (avoids List[End] type error)
    if not tags:
        tags = nbtlib.List[nbtlib.String]()

    existing = [str(t) for t in tags]
    if enabled and TAG_NAME not in existing:
        tags.append(nbtlib.String(TAG_NAME))
    elif not enabled and TAG_NAME in existing:
        tags = nbtlib.List[nbtlib.String]([t for t in tags if str(t) != TAG_NAME])

    root["Tags"] = tags
    nbt.save(path)
    print("ok")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} get <uuid>  |  {sys.argv[0]} set <uuid> true|false",
              file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]
    uuid   = sys.argv[2].replace("'", "")  # strip any stray quotes

    if action == "get":
        print("true" if get_status(uuid) else "false")
    elif action == "set":
        if len(sys.argv) < 4:
            print("ERROR: set requires true or false", file=sys.stderr)
            sys.exit(1)
        enabled = sys.argv[3].lower() in ("true", "1", "yes")
        set_status(uuid, enabled)
    else:
        print(f"ERROR: unknown action '{action}'", file=sys.stderr)
        sys.exit(1)

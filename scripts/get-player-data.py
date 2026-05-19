#!/usr/bin/env python3
"""
Read every world/playerdata/<UUID>.dat file and output a JSON array of
player snapshots (position, dimension, inventory, health).

Usage:  python3 get-player-data.py [world_dir]
        world_dir defaults to /opt/minecraft/server/world
"""
import json, sys, os

try:
    import nbtlib
except ImportError:
    sys.stderr.write("ERROR: nbtlib not installed — run: pip3 install nbtlib\n")
    print("[]")
    sys.exit(0)

WORLD_DIR      = sys.argv[1] if len(sys.argv) > 1 else "/opt/minecraft/server/world"
PLAYERDATA_DIR = os.path.join(WORLD_DIR, "playerdata")
USERCACHE      = os.path.join(os.path.dirname(WORLD_DIR), "usercache.json")

# ── UUID → IGN mapping from usercache ────────────────────────────────────────
uuid_to_ign: dict[str, str] = {}
try:
    with open(USERCACHE) as f:
        for entry in json.load(f):
            uuid_to_ign[entry["uuid"]] = entry["name"]
except Exception:
    pass

DIMENSION_ALIASES = {
    "0":  "minecraft:overworld",
    "-1": "minecraft:the_nether",
    "1":  "minecraft:the_end",
}

def clean_dim(raw: str) -> str:
    return DIMENSION_ALIASES.get(raw, raw)

def item_to_dict(item) -> dict | None:
    try:
        # 1.20+ uses lowercase "count" and "id" as direct compound keys
        item_id = str(item.get("id", item.get("Id", "minecraft:air")))
        count   = int(item.get("count", item.get("Count", 1)))
        slot    = int(item.get("Slot", -1))
        if item_id == "minecraft:air":
            return None
        return {"id": item_id, "count": count, "slot": slot}
    except Exception:
        return None

# ── Main extraction ───────────────────────────────────────────────────────────
results = []

if not os.path.isdir(PLAYERDATA_DIR):
    print("[]")
    sys.exit(0)

for filename in sorted(os.listdir(PLAYERDATA_DIR)):
    if not filename.endswith(".dat") or filename.endswith("_old.dat"):
        continue

    uuid     = filename[:-4]
    ign      = uuid_to_ign.get(uuid, uuid)
    filepath = os.path.join(PLAYERDATA_DIR, filename)

    try:
        nbt  = nbtlib.load(filepath)
        root = nbt.get("", nbt)   # root compound (named "" in Java Edition)

        pos       = root.get("Pos", [0.0, 64.0, 0.0])
        rot       = root.get("Rotation", [0.0, 0.0])
        dim_raw   = str(root.get("Dimension", "minecraft:overworld"))
        dimension = clean_dim(dim_raw)
        health    = float(root.get("Health", root.get("health", 20.0)))

        inventory = []
        for item in root.get("Inventory", []):
            d = item_to_dict(item)
            if d:
                inventory.append(d)

        results.append({
            "uuid":      uuid,
            "ign":       ign,
            "x":         round(float(pos[0]), 2),
            "y":         round(float(pos[1]), 2),
            "z":         round(float(pos[2]), 2),
            "yaw":       round(float(rot[0]), 2),
            "dimension": dimension,
            "health":    round(health, 1),
            "inventory": inventory,
        })
    except Exception as exc:
        results.append({
            "uuid": uuid, "ign": ign,
            "x": 0.0, "y": 64.0, "z": 0.0,
            "yaw": 0.0, "dimension": "minecraft:overworld",
            "health": 20.0, "inventory": [],
            "error": str(exc),
        })

print(json.dumps(results))

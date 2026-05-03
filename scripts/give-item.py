#!/usr/bin/env python3
"""
Add an item to an offline player's inventory by modifying their playerdata NBT.
Items appear when the player next opens their inventory in-game.

Usage:  python3 give-item.py <UUID> <item_id> <count>
        e.g.  give-item.py 64384a4c-665d-487b-9d7e-b00764030ec5 minecraft:diamond 32
"""
import sys, os

try:
    import nbtlib
except ImportError:
    print("ERROR: nbtlib not installed — run: pip3 install nbtlib", file=sys.stderr)
    sys.exit(1)

if len(sys.argv) < 4:
    print(f"Usage: {sys.argv[0]} <UUID> <item_id> <count>", file=sys.stderr)
    sys.exit(1)

uuid    = sys.argv[1]
item_id = sys.argv[2]
if not item_id.startswith("minecraft:"):
    item_id = f"minecraft:{item_id}"
count   = max(1, min(int(sys.argv[3]), 64))

WORLD_DIR       = "/opt/minecraft/server/world"
PLAYERDATA_FILE = os.path.join(WORLD_DIR, "playerdata", f"{uuid}.dat")

if not os.path.exists(PLAYERDATA_FILE):
    print(f"ERROR: no playerdata for UUID {uuid}", file=sys.stderr)
    sys.exit(1)

nbt  = nbtlib.load(PLAYERDATA_FILE)
root = nbt.get("", nbt)

inventory = root.get("Inventory", nbtlib.List[nbtlib.Compound]())

# ── 1. Try to stack onto an existing matching slot ────────────────────────────
for item in inventory:
    stored_id = str(item.get("id", ""))
    if stored_id != item_id:
        continue
    # Handle both 1.20+ "count" and older "Count"
    key        = "count" if "count" in item else "Count"
    existing   = int(item[key])
    if existing >= 64:
        continue
    can_add    = min(count, 64 - existing)
    item[key]  = nbtlib.Int(existing + can_add) if key == "count" else nbtlib.Byte(existing + can_add)
    count     -= can_add
    if count <= 0:
        nbt.save(PLAYERDATA_FILE)
        print(f"OK stacked onto existing {item_id} slot")
        sys.exit(0)

# ── 2. Find a free slot (main inventory 9-35 preferred, then hotbar 0-8) ─────
occupied = {int(item.get("Slot", -1)) for item in inventory}
target   = next(
    (s for s in list(range(9, 36)) + list(range(0, 9)) if s not in occupied),
    None,
)

if target is None:
    print("ERROR: inventory full", file=sys.stderr)
    sys.exit(1)

# ── 3. Append new item compound ───────────────────────────────────────────────
new_item = nbtlib.Compound({
    "id":    nbtlib.String(item_id),
    "Count": nbtlib.Byte(count),
    "Slot":  nbtlib.Byte(target),
})
inventory.append(new_item)
root["Inventory"] = inventory
nbt.save(PLAYERDATA_FILE)
print(f"OK added {count}x {item_id} to slot {target}")

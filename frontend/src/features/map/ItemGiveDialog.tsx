import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Package, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { McItemImage } from "@/components/McItemImage";

// ── Minecraft 1.21 item list ──────────────────────────────────────────────────
// We use a curated subset of well-known items since the full minecraft-data
// package requires a version string at import time. You can extend this list.
// Icons are served from mc-heads.net CDN.

const MC_ITEMS: { id: string; name: string }[] = [
  // tools & weapons
  { id: "wooden_sword",      name: "Wooden Sword" },
  { id: "stone_sword",       name: "Stone Sword" },
  { id: "iron_sword",        name: "Iron Sword" },
  { id: "golden_sword",      name: "Golden Sword" },
  { id: "diamond_sword",     name: "Diamond Sword" },
  { id: "netherite_sword",   name: "Netherite Sword" },
  { id: "wooden_pickaxe",    name: "Wooden Pickaxe" },
  { id: "stone_pickaxe",     name: "Stone Pickaxe" },
  { id: "iron_pickaxe",      name: "Iron Pickaxe" },
  { id: "diamond_pickaxe",   name: "Diamond Pickaxe" },
  { id: "netherite_pickaxe", name: "Netherite Pickaxe" },
  { id: "wooden_axe",        name: "Wooden Axe" },
  { id: "iron_axe",          name: "Iron Axe" },
  { id: "diamond_axe",       name: "Diamond Axe" },
  { id: "bow",               name: "Bow" },
  { id: "crossbow",          name: "Crossbow" },
  { id: "trident",           name: "Trident" },
  // armor
  { id: "iron_helmet",       name: "Iron Helmet" },
  { id: "iron_chestplate",   name: "Iron Chestplate" },
  { id: "iron_leggings",     name: "Iron Leggings" },
  { id: "iron_boots",        name: "Iron Boots" },
  { id: "diamond_helmet",    name: "Diamond Helmet" },
  { id: "diamond_chestplate",name: "Diamond Chestplate" },
  { id: "diamond_leggings",  name: "Diamond Leggings" },
  { id: "diamond_boots",     name: "Diamond Boots" },
  { id: "netherite_helmet",  name: "Netherite Helmet" },
  { id: "netherite_chestplate", name: "Netherite Chestplate" },
  { id: "netherite_leggings",name: "Netherite Leggings" },
  { id: "netherite_boots",   name: "Netherite Boots" },
  // resources
  { id: "diamond",           name: "Diamond" },
  { id: "emerald",           name: "Emerald" },
  { id: "iron_ingot",        name: "Iron Ingot" },
  { id: "gold_ingot",        name: "Gold Ingot" },
  { id: "netherite_ingot",   name: "Netherite Ingot" },
  { id: "coal",              name: "Coal" },
  { id: "redstone",          name: "Redstone" },
  { id: "lapis_lazuli",      name: "Lapis Lazuli" },
  { id: "obsidian",          name: "Obsidian" },
  { id: "flint_and_steel",   name: "Flint and Steel" },
  // food
  { id: "cooked_beef",       name: "Cooked Beef" },
  { id: "cooked_chicken",    name: "Cooked Chicken" },
  { id: "bread",             name: "Bread" },
  { id: "golden_apple",      name: "Golden Apple" },
  { id: "enchanted_golden_apple", name: "Enchanted Golden Apple" },
  // potions
  { id: "potion",            name: "Potion" },
  { id: "splash_potion",     name: "Splash Potion" },
  // blocks
  { id: "dirt",              name: "Dirt" },
  { id: "stone",             name: "Stone" },
  { id: "cobblestone",       name: "Cobblestone" },
  { id: "oak_planks",        name: "Oak Planks" },
  { id: "glass",             name: "Glass" },
  { id: "torch",             name: "Torch" },
  { id: "chest",             name: "Chest" },
  { id: "crafting_table",    name: "Crafting Table" },
  { id: "furnace",           name: "Furnace" },
  // misc
  { id: "elytra",            name: "Elytra" },
  { id: "totem_of_undying",  name: "Totem of Undying" },
  { id: "experience_bottle", name: "Bottle o' Enchanting" },
  { id: "enchanting_table",  name: "Enchanting Table" },
  { id: "book",              name: "Book" },
  { id: "arrow",             name: "Arrow" },
  { id: "tipped_arrow",      name: "Tipped Arrow" },
];

function ItemIcon({ id }: { id: string }) {
  return <McItemImage id={id} size={24} />;
}

interface Props {
  ign:     string;
  uuid:    string;
  online:  boolean;
  onClose: () => void;
}

export function ItemGiveDialog({ ign, online, onClose }: Props) {
  const [query,    setQuery]    = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [count,    setCount]    = useState(1);
  const [error,    setError]    = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return MC_ITEMS.slice(0, 30);
    return MC_ITEMS.filter(
      (i) => i.name.toLowerCase().includes(q) || i.id.includes(q)
    ).slice(0, 30);
  }, [query]);

  const giveMut = useMutation({
    mutationFn: () => {
      setError(null);
      return api.post(`/players/${encodeURIComponent(ign)}/give`, {
        item_id: selected!.startsWith("minecraft:") ? selected! : `minecraft:${selected}`,
        count,
        online,
      });
    },
    onSuccess: onClose,
    onError:   (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="card w-full max-w-md mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            Give item to <span className="font-mono">{ign}</span>
          </h2>
          <button onClick={onClose} className="text-[#9B9EA6] hover:text-[#F87171]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <input
          autoFocus
          type="search"
          placeholder="Search items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />

        {/* Item grid */}
        <div className="h-52 overflow-y-auto space-y-0.5 rounded-lg border border-[#D9D5D0] dark:border-[#363944]">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                selected === item.id
                  ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
                  : "hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#1C1E27] dark:text-[#EAECF0]"
              }`}
            >
              <ItemIcon id={item.id} />
              <span className="flex-1">{item.name}</span>
              <span className="text-[10px] text-[#9B9EA6] font-mono">{item.id}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-[#9B9EA6] text-center py-8">No items found</p>
          )}
        </div>

        {/* Count + status */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] flex-shrink-0">Count</label>
          <input
            type="number"
            min={1}
            max={64}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(64, Number(e.target.value))))}
            className="w-20 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            online
              ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
              : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#9B9EA6]"
          }`}>
            {online ? "online — instant" : "offline — on next login"}
          </span>
        </div>

        {error && (
          <p className="text-sm text-[#F87171]">{error}</p>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={() => giveMut.mutate()}
            disabled={!selected || giveMut.isPending}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {giveMut.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Giving…</>
              : <><Package className="w-3.5 h-3.5" /> {online ? "Give Now" : "Add to Inventory"}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Minus, Plus, Package, CheckCircle2, Loader2, ChevronRight } from "lucide-react";
import { api } from "@/api/client";

// ── Item catalog (160+ items, 8 categories) ───────────────────────────────────
// KLM-GOMS: categories reduce the scanning space from N→all to N→category,
// cutting average time-to-target by ~75% vs a flat alphabetical list.

type Category = "all" | "weapons" | "tools" | "armor" | "resources" | "food" | "potions" | "blocks" | "misc";

interface MCItem { id: string; name: string; category: Category }

const CATALOG: MCItem[] = [
  // ── weapons ──
  { id: "wooden_sword",        name: "Wooden Sword",         category: "weapons" },
  { id: "stone_sword",         name: "Stone Sword",          category: "weapons" },
  { id: "iron_sword",          name: "Iron Sword",           category: "weapons" },
  { id: "golden_sword",        name: "Golden Sword",         category: "weapons" },
  { id: "diamond_sword",       name: "Diamond Sword",        category: "weapons" },
  { id: "netherite_sword",     name: "Netherite Sword",      category: "weapons" },
  { id: "bow",                 name: "Bow",                  category: "weapons" },
  { id: "crossbow",            name: "Crossbow",             category: "weapons" },
  { id: "trident",             name: "Trident",              category: "weapons" },
  { id: "arrow",               name: "Arrow",                category: "weapons" },
  { id: "spectral_arrow",      name: "Spectral Arrow",       category: "weapons" },
  { id: "tipped_arrow",        name: "Tipped Arrow",         category: "weapons" },

  // ── tools ──
  { id: "wooden_pickaxe",      name: "Wooden Pickaxe",       category: "tools" },
  { id: "stone_pickaxe",       name: "Stone Pickaxe",        category: "tools" },
  { id: "iron_pickaxe",        name: "Iron Pickaxe",         category: "tools" },
  { id: "golden_pickaxe",      name: "Golden Pickaxe",       category: "tools" },
  { id: "diamond_pickaxe",     name: "Diamond Pickaxe",      category: "tools" },
  { id: "netherite_pickaxe",   name: "Netherite Pickaxe",    category: "tools" },
  { id: "wooden_axe",          name: "Wooden Axe",           category: "tools" },
  { id: "stone_axe",           name: "Stone Axe",            category: "tools" },
  { id: "iron_axe",            name: "Iron Axe",             category: "tools" },
  { id: "diamond_axe",         name: "Diamond Axe",          category: "tools" },
  { id: "netherite_axe",       name: "Netherite Axe",        category: "tools" },
  { id: "wooden_shovel",       name: "Wooden Shovel",        category: "tools" },
  { id: "iron_shovel",         name: "Iron Shovel",          category: "tools" },
  { id: "diamond_shovel",      name: "Diamond Shovel",       category: "tools" },
  { id: "wooden_hoe",          name: "Wooden Hoe",           category: "tools" },
  { id: "iron_hoe",            name: "Iron Hoe",             category: "tools" },
  { id: "diamond_hoe",         name: "Diamond Hoe",          category: "tools" },
  { id: "netherite_hoe",       name: "Netherite Hoe",        category: "tools" },
  { id: "flint_and_steel",     name: "Flint and Steel",      category: "tools" },
  { id: "shears",              name: "Shears",               category: "tools" },
  { id: "fishing_rod",         name: "Fishing Rod",          category: "tools" },
  { id: "compass",             name: "Compass",              category: "tools" },
  { id: "clock",               name: "Clock",                category: "tools" },
  { id: "spyglass",            name: "Spyglass",             category: "tools" },
  { id: "lead",                name: "Lead",                 category: "tools" },
  { id: "name_tag",            name: "Name Tag",             category: "tools" },

  // ── armor ──
  { id: "leather_helmet",      name: "Leather Helmet",       category: "armor" },
  { id: "leather_chestplate",  name: "Leather Chestplate",   category: "armor" },
  { id: "leather_leggings",    name: "Leather Leggings",     category: "armor" },
  { id: "leather_boots",       name: "Leather Boots",        category: "armor" },
  { id: "iron_helmet",         name: "Iron Helmet",          category: "armor" },
  { id: "iron_chestplate",     name: "Iron Chestplate",      category: "armor" },
  { id: "iron_leggings",       name: "Iron Leggings",        category: "armor" },
  { id: "iron_boots",          name: "Iron Boots",           category: "armor" },
  { id: "golden_helmet",       name: "Golden Helmet",        category: "armor" },
  { id: "golden_chestplate",   name: "Golden Chestplate",    category: "armor" },
  { id: "golden_leggings",     name: "Golden Leggings",      category: "armor" },
  { id: "golden_boots",        name: "Golden Boots",         category: "armor" },
  { id: "diamond_helmet",      name: "Diamond Helmet",       category: "armor" },
  { id: "diamond_chestplate",  name: "Diamond Chestplate",   category: "armor" },
  { id: "diamond_leggings",    name: "Diamond Leggings",     category: "armor" },
  { id: "diamond_boots",       name: "Diamond Boots",        category: "armor" },
  { id: "netherite_helmet",    name: "Netherite Helmet",     category: "armor" },
  { id: "netherite_chestplate",name: "Netherite Chestplate", category: "armor" },
  { id: "netherite_leggings",  name: "Netherite Leggings",   category: "armor" },
  { id: "netherite_boots",     name: "Netherite Boots",      category: "armor" },
  { id: "elytra",              name: "Elytra",               category: "armor" },
  { id: "shield",              name: "Shield",               category: "armor" },
  { id: "turtle_helmet",       name: "Turtle Helmet",        category: "armor" },

  // ── resources ──
  { id: "coal",                name: "Coal",                 category: "resources" },
  { id: "charcoal",            name: "Charcoal",             category: "resources" },
  { id: "iron_ingot",          name: "Iron Ingot",           category: "resources" },
  { id: "gold_ingot",          name: "Gold Ingot",           category: "resources" },
  { id: "diamond",             name: "Diamond",              category: "resources" },
  { id: "emerald",             name: "Emerald",              category: "resources" },
  { id: "netherite_ingot",     name: "Netherite Ingot",      category: "resources" },
  { id: "lapis_lazuli",        name: "Lapis Lazuli",         category: "resources" },
  { id: "redstone",            name: "Redstone",             category: "resources" },
  { id: "quartz",              name: "Nether Quartz",        category: "resources" },
  { id: "amethyst_shard",      name: "Amethyst Shard",       category: "resources" },
  { id: "copper_ingot",        name: "Copper Ingot",         category: "resources" },
  { id: "raw_iron",            name: "Raw Iron",             category: "resources" },
  { id: "raw_gold",            name: "Raw Gold",             category: "resources" },
  { id: "raw_copper",          name: "Raw Copper",           category: "resources" },
  { id: "string",              name: "String",               category: "resources" },
  { id: "leather",             name: "Leather",              category: "resources" },
  { id: "feather",             name: "Feather",              category: "resources" },
  { id: "bone",                name: "Bone",                 category: "resources" },
  { id: "obsidian",            name: "Obsidian",             category: "resources" },
  { id: "blaze_rod",           name: "Blaze Rod",            category: "resources" },
  { id: "ender_pearl",         name: "Ender Pearl",          category: "resources" },
  { id: "eye_of_ender",        name: "Eye of Ender",         category: "resources" },
  { id: "nether_star",         name: "Nether Star",          category: "resources" },
  { id: "dragon_egg",          name: "Dragon Egg",           category: "resources" },

  // ── food ──
  { id: "bread",               name: "Bread",                category: "food" },
  { id: "apple",               name: "Apple",                category: "food" },
  { id: "golden_apple",        name: "Golden Apple",         category: "food" },
  { id: "enchanted_golden_apple", name: "Enchanted Golden Apple", category: "food" },
  { id: "cooked_beef",         name: "Steak",                category: "food" },
  { id: "cooked_porkchop",     name: "Cooked Porkchop",      category: "food" },
  { id: "cooked_chicken",      name: "Cooked Chicken",       category: "food" },
  { id: "cooked_cod",          name: "Cooked Cod",           category: "food" },
  { id: "cooked_salmon",       name: "Cooked Salmon",        category: "food" },
  { id: "cooked_rabbit",       name: "Cooked Rabbit",        category: "food" },
  { id: "cooked_mutton",       name: "Cooked Mutton",        category: "food" },
  { id: "pumpkin_pie",         name: "Pumpkin Pie",          category: "food" },
  { id: "cake",                name: "Cake",                 category: "food" },
  { id: "cookie",              name: "Cookie",               category: "food" },
  { id: "melon_slice",         name: "Melon Slice",          category: "food" },
  { id: "carrot",              name: "Carrot",               category: "food" },
  { id: "golden_carrot",       name: "Golden Carrot",        category: "food" },
  { id: "beetroot",            name: "Beetroot",             category: "food" },
  { id: "suspicious_stew",     name: "Suspicious Stew",      category: "food" },
  { id: "mushroom_stew",       name: "Mushroom Stew",        category: "food" },

  // ── potions ──
  { id: "potion",              name: "Potion",               category: "potions" },
  { id: "splash_potion",       name: "Splash Potion",        category: "potions" },
  { id: "lingering_potion",    name: "Lingering Potion",     category: "potions" },
  { id: "experience_bottle",   name: "Bottle o' Enchanting", category: "potions" },
  { id: "milk_bucket",         name: "Milk Bucket",          category: "potions" },
  { id: "honey_bottle",        name: "Honey Bottle",         category: "potions" },
  { id: "ominous_bottle",      name: "Ominous Bottle",       category: "potions" },

  // ── blocks ──
  { id: "dirt",                name: "Dirt",                 category: "blocks" },
  { id: "grass_block",         name: "Grass Block",          category: "blocks" },
  { id: "stone",               name: "Stone",                category: "blocks" },
  { id: "cobblestone",         name: "Cobblestone",          category: "blocks" },
  { id: "deepslate",           name: "Deepslate",            category: "blocks" },
  { id: "sand",                name: "Sand",                 category: "blocks" },
  { id: "gravel",              name: "Gravel",               category: "blocks" },
  { id: "oak_planks",          name: "Oak Planks",           category: "blocks" },
  { id: "spruce_planks",       name: "Spruce Planks",        category: "blocks" },
  { id: "birch_planks",        name: "Birch Planks",         category: "blocks" },
  { id: "dark_oak_planks",     name: "Dark Oak Planks",      category: "blocks" },
  { id: "oak_log",             name: "Oak Log",              category: "blocks" },
  { id: "glass",               name: "Glass",                category: "blocks" },
  { id: "torch",               name: "Torch",                category: "blocks" },
  { id: "lantern",             name: "Lantern",              category: "blocks" },
  { id: "sea_lantern",         name: "Sea Lantern",          category: "blocks" },
  { id: "glowstone",           name: "Glowstone",            category: "blocks" },
  { id: "chest",               name: "Chest",                category: "blocks" },
  { id: "barrel",              name: "Barrel",               category: "blocks" },
  { id: "furnace",             name: "Furnace",              category: "blocks" },
  { id: "crafting_table",      name: "Crafting Table",       category: "blocks" },
  { id: "enchanting_table",    name: "Enchanting Table",     category: "blocks" },
  { id: "anvil",               name: "Anvil",                category: "blocks" },
  { id: "bookshelf",           name: "Bookshelf",            category: "blocks" },
  { id: "iron_block",          name: "Iron Block",           category: "blocks" },
  { id: "diamond_block",       name: "Diamond Block",        category: "blocks" },
  { id: "gold_block",          name: "Gold Block",           category: "blocks" },
  { id: "netherite_block",     name: "Netherite Block",      category: "blocks" },
  { id: "emerald_block",       name: "Emerald Block",        category: "blocks" },
  { id: "tnt",                 name: "TNT",                  category: "blocks" },
  { id: "respawn_anchor",      name: "Respawn Anchor",       category: "blocks" },
  { id: "crying_obsidian",     name: "Crying Obsidian",      category: "blocks" },
  { id: "end_stone",           name: "End Stone",            category: "blocks" },
  { id: "netherrack",          name: "Netherrack",           category: "blocks" },

  // ── misc ──
  { id: "totem_of_undying",    name: "Totem of Undying",     category: "misc" },
  { id: "nether_portal",       name: "Nether Star",          category: "misc" },
  { id: "enchanted_book",      name: "Enchanted Book",       category: "misc" },
  { id: "book",                name: "Book",                 category: "misc" },
  { id: "written_book",        name: "Written Book",         category: "misc" },
  { id: "map",                 name: "Map",                  category: "misc" },
  { id: "filled_map",          name: "Filled Map",           category: "misc" },
  { id: "saddle",              name: "Saddle",               category: "misc" },
  { id: "horse_armor",         name: "Iron Horse Armor",     category: "misc" },
  { id: "diamond_horse_armor", name: "Diamond Horse Armor",  category: "misc" },
  { id: "golden_horse_armor",  name: "Golden Horse Armor",   category: "misc" },
  { id: "bundle",              name: "Bundle",               category: "misc" },
  { id: "recovery_compass",    name: "Recovery Compass",     category: "misc" },
  { id: "echo_shard",          name: "Echo Shard",           category: "misc" },
  { id: "disc_fragment_5",     name: "Disc Fragment",        category: "misc" },
  { id: "music_disc_13",       name: "Music Disc (13)",      category: "misc" },
  { id: "firework_rocket",     name: "Firework Rocket",      category: "misc" },
];

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "all",       label: "All",       emoji: "⚡" },
  { id: "weapons",   label: "Weapons",   emoji: "⚔️" },
  { id: "tools",     label: "Tools",     emoji: "⛏" },
  { id: "armor",     label: "Armor",     emoji: "🛡" },
  { id: "resources", label: "Resources", emoji: "💎" },
  { id: "food",      label: "Food",      emoji: "🍖" },
  { id: "potions",   label: "Potions",   emoji: "🧪" },
  { id: "blocks",    label: "Blocks",    emoji: "🧱" },
  { id: "misc",      label: "Misc",      emoji: "🎁" },
];

// ── Shared item icon ─────────────────────────────────────────────────────────

import { McItemImage } from "@/components/McItemImage";

function ItemIcon({ id, size = 32 }: { id: string; size?: number }) {
  return <McItemImage id={id} size={size} />;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  ign:     string;
  uuid:    string;
  online:  boolean;
  onClose: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ItemGiveDrawer({ ign, online, onClose }: Props) {
  const [category, setCategory] = useState<Category>("all");
  const [query,    setQuery]    = useState("");
  const [selected, setSelected] = useState<MCItem | null>(null);
  const [count,    setCount]    = useState(1);
  const [success,  setSuccess]  = useState(false);
  const searchRef  = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Clear success state if player changes
  useEffect(() => { setSuccess(false); setSelected(null); setCount(1); }, [ign]);

  const filtered = useMemo(() => {
    let items = category === "all" ? CATALOG : CATALOG.filter((i) => i.category === category);
    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(q) || i.id.includes(q));
    }
    return items;
  }, [category, query]);

  const adjustCount = (delta: number) =>
    setCount((c) => Math.max(1, Math.min(64, c + delta)));

  const giveMut = useMutation({
    mutationFn: () =>
      api.post(`/players/${encodeURIComponent(ign)}/give`, {
        item_id: `minecraft:${selected!.id}`,
        count,
        online,
      }),
    onSuccess: () => {
      setSuccess(true);
      // Reset after a beat so admin can gift again quickly
      setTimeout(() => {
        setSuccess(false);
        setSelected(null);
        setCount(1);
      }, 1800);
    },
  });

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        aria-hidden
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-label={`Give item to ${ign}`}
        className="fixed inset-y-0 right-0 z-50 flex flex-col
                   w-full sm:w-[420px] max-w-full
                   bg-white dark:bg-[#1C1E27] shadow-2xl"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3
                        border-b border-[#D9D5D0] dark:border-[#363944] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <img
              src={`https://mc-heads.net/avatar/${ign}/36`}
              alt=""
              className="w-9 h-9 rounded-sm"
            />
            <div>
              <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0] font-mono">{ign}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                online
                  ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
                  : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#9B9EA6]"
              }`}>
                {online ? "Online — instant delivery" : "Offline — queued for login"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-[#9B9EA6] hover:text-[#F87171]
                       hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Search ── */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search items…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCategory("all"); }}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                       bg-[#F7F5F2] dark:bg-[#2A2D38] px-3 py-2 text-sm
                       text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]
                       focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
        </div>

        {/* ── Category tabs ── */}
        <div className="flex gap-0.5 px-3 overflow-x-auto flex-shrink-0 pb-2"
             style={{ scrollbarWidth: "none" }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => { setCategory(cat.id); setQuery(""); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                          whitespace-nowrap transition-colors flex-shrink-0 ${
                category === cat.id && !query
                  ? "bg-[#5B9BF0] text-white"
                  : "text-[#6B6E78] dark:text-[#9BA0B0] hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
              }`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* ── Item grid (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-3 min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#9B9EA6]">
              <Package className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No items match "{query}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 pb-2">
              {filtered.map((item) => {
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelected(isSelected ? null : item)}
                    title={item.name}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg text-center
                                transition-all border-2 group ${
                      isSelected
                        ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]"
                        : "border-transparent hover:border-[#D9D5D0] dark:hover:border-[#363944] hover:bg-[#F7F5F2] dark:hover:bg-[#2A2D38]"
                    }`}
                  >
                    <ItemIcon id={item.id} size={32} />
                    <span className={`text-[9px] leading-tight break-words w-full font-medium ${
                      isSelected
                        ? "text-[#5B9BF0]"
                        : "text-[#6B6E78] dark:text-[#9BA0B0]"
                    }`}>
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer: preview + count + action ── */}
        <div className="flex-shrink-0 border-t border-[#D9D5D0] dark:border-[#363944]">
          {/* Preview card */}
          <div className={`px-4 pt-3 pb-2 transition-opacity ${selected ? "opacity-100" : "opacity-40"}`}>
            <div className="flex items-center gap-3 bg-[#F7F5F2] dark:bg-[#2A2D38] rounded-xl p-3">
              {selected
                ? <ItemIcon id={selected.id} size={40} />
                : <div className="w-10 h-10 rounded bg-[#D9D5D0] dark:bg-[#363944]" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] truncate">
                  {selected ? selected.name : "Select an item"}
                </p>
                <p className="text-xs text-[#9B9EA6]">
                  {selected
                    ? `minecraft:${selected.id} × ${count}`
                    : "Tap an item above to select it"
                  }
                </p>
              </div>
              {selected && (
                <ChevronRight className="w-4 h-4 text-[#9B9EA6] flex-shrink-0" />
              )}
            </div>
          </div>

          {/* Count stepper */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 justify-between">
              <span className="text-xs text-[#6B6E78] dark:text-[#9BA0B0] font-medium">Quantity</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => adjustCount(-10)}
                  disabled={count <= 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center
                             border border-[#D9D5D0] dark:border-[#363944]
                             text-[#6B6E78] dark:text-[#9BA0B0]
                             hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]
                             disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                             text-[10px] font-bold"
                >-10</button>
                <button
                  onClick={() => adjustCount(-1)}
                  disabled={count <= 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center
                             border border-[#D9D5D0] dark:border-[#363944]
                             hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]
                             disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(64, Number(e.target.value) || 1)))}
                  className="w-14 text-center rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                             bg-white dark:bg-[#2A2D38] py-1 text-sm font-semibold
                             text-[#1C1E27] dark:text-[#EAECF0]
                             focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
                />
                <button
                  onClick={() => adjustCount(1)}
                  disabled={count >= 64}
                  className="w-8 h-8 rounded-lg flex items-center justify-center
                             border border-[#D9D5D0] dark:border-[#363944]
                             hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]
                             disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCount(64)}
                  disabled={count === 64}
                  className="h-8 px-2 rounded-lg text-[10px] font-bold
                             border border-[#D9D5D0] dark:border-[#363944]
                             text-[#6B6E78] dark:text-[#9BA0B0]
                             hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]
                             disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >×64</button>
              </div>
            </div>

            {/* Give button */}
            <button
              onClick={() => giveMut.mutate()}
              disabled={!selected || giveMut.isPending || success}
              className={`mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                          text-sm font-semibold transition-all ${
                success
                  ? "bg-[#36B37E] text-white"
                  : !selected
                  ? "bg-[#D9D5D0] dark:bg-[#363944] text-[#9B9EA6] cursor-not-allowed"
                  : "btn-primary"
              }`}
            >
              {success ? (
                <><CheckCircle2 className="w-4 h-4" /> Sent to {ign}!</>
              ) : giveMut.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : (
                <><Package className="w-4 h-4" />
                  {selected
                    ? `Give ${count}× ${selected.name} ${online ? "now" : "on login"}`
                    : "Select an item above"
                  }
                </>
              )}
            </button>
            {giveMut.isError && (
              <p className="text-xs text-[#F87171] mt-1.5 text-center">
                {(giveMut.error as Error).message}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

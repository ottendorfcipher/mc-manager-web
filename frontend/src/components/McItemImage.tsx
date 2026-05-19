import { useState, useEffect } from "react";

/**
 * Renders a Minecraft item texture.
 *
 * Resolution order:
 *  1. For items whose primary texture lives in block/ (all placeable blocks,
 *     most plants), go directly to block/{name}.png — no wasted 404 round-trip.
 *  2. For all other items, try item/{name}.png first.
 *     On error, fall back to block/{name}.png (handles edge cases).
 *  3. If both fail, show a styled placeholder with the item name.
 *
 * Source: InventivetalentDev/minecraft-assets@1.21.1 via jsDelivr CDN.
 * preconnect hint in index.html ensures the CDN connection is pre-warmed.
 */

const BASE =
  "https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures/";

// ── Item IDs whose texture lives in block/ not item/ ─────────────────────────
// Keeping this set avoids a 404 round-trip for every block or plant item that
// appears in the inventory viewer or the give-item drawer.
// Seeds and other crops-as-items are intentionally absent (they use item/).
const BLOCK_TEXTURE_IDS = new Set([
  // ── Terrain ──────────────────────────────────────────────────────────────
  "dirt","grass_block","podzol","mycelium","rooted_dirt","mud","packed_mud",
  "mud_bricks","sand","red_sand","gravel","clay",
  // ── Stone & deepslate ────────────────────────────────────────────────────
  "stone","cobblestone","stone_bricks","mossy_cobblestone","mossy_stone_bricks",
  "cracked_stone_bricks","smooth_stone","bricks","granite","diorite","andesite",
  "polished_granite","polished_diorite","polished_andesite",
  "deepslate","cobbled_deepslate","polished_deepslate","deepslate_bricks",
  "deepslate_tiles","tuff","calcite","dripstone_block","pointed_dripstone",
  // ── Ores ─────────────────────────────────────────────────────────────────
  "coal_ore","iron_ore","copper_ore","gold_ore","lapis_ore","redstone_ore",
  "diamond_ore","emerald_ore","ancient_debris","nether_quartz_ore","nether_gold_ore",
  // ── Wood: logs, stems, planks ────────────────────────────────────────────
  "oak_log","spruce_log","birch_log","jungle_log","acacia_log","dark_oak_log",
  "mangrove_log","cherry_log","crimson_stem","warped_stem",
  "oak_planks","spruce_planks","birch_planks","jungle_planks","acacia_planks",
  "dark_oak_planks","mangrove_planks","cherry_planks","crimson_planks","warped_planks",
  // ── Wool ─────────────────────────────────────────────────────────────────
  "white_wool","orange_wool","magenta_wool","light_blue_wool","yellow_wool",
  "lime_wool","pink_wool","gray_wool","light_gray_wool","cyan_wool","purple_wool",
  "blue_wool","brown_wool","green_wool","red_wool","black_wool",
  // ── Concrete ─────────────────────────────────────────────────────────────
  "white_concrete","orange_concrete","magenta_concrete","light_blue_concrete",
  "yellow_concrete","lime_concrete","pink_concrete","gray_concrete",
  "light_gray_concrete","cyan_concrete","purple_concrete","blue_concrete",
  "brown_concrete","green_concrete","red_concrete","black_concrete",
  // ── Terracotta ───────────────────────────────────────────────────────────
  "terracotta","white_terracotta","orange_terracotta","magenta_terracotta",
  "light_blue_terracotta","yellow_terracotta","lime_terracotta","pink_terracotta",
  "gray_terracotta","light_gray_terracotta","cyan_terracotta","purple_terracotta",
  "blue_terracotta","brown_terracotta","green_terracotta","red_terracotta",
  "black_terracotta",
  // ── Nether blocks ────────────────────────────────────────────────────────
  "netherrack","nether_bricks","soul_sand","soul_soil","magma_block","basalt",
  "blackstone","gilded_blackstone",
  // ── End blocks ───────────────────────────────────────────────────────────
  "end_stone","end_stone_bricks","purpur_block","end_rod",
  // ── Ocean blocks ─────────────────────────────────────────────────────────
  "prismarine","prismarine_bricks","dark_prismarine","sponge","wet_sponge",
  // ── Special mineral / amethyst / copper blocks ───────────────────────────
  "amethyst_block","budding_amethyst",
  "copper_block","exposed_copper","weathered_copper","oxidized_copper",
  "sculk","sculk_sensor","sculk_catalyst","sculk_shrieker",
  "obsidian","dragon_egg",
  // ── Value blocks ─────────────────────────────────────────────────────────
  "iron_block","diamond_block","gold_block","netherite_block","emerald_block",
  "lapis_block","coal_block",
  // ── Redstone blocks ──────────────────────────────────────────────────────
  "redstone_block","redstone_lamp","observer","dispenser","dropper","hopper",
  "piston","sticky_piston","target","lightning_rod",
  // ── Misc placeable blocks ────────────────────────────────────────────────
  "tnt","respawn_anchor","crying_obsidian","vault","trial_spawner",
  "slime_block","honey_block","hay_block","dried_kelp_block",
  "bookshelf","scaffolding",
  // ── Flowers ──────────────────────────────────────────────────────────────
  "dandelion","poppy","blue_orchid","allium","azure_bluet",
  "red_tulip","orange_tulip","white_tulip","pink_tulip","oxeye_daisy",
  "cornflower","lily_of_the_valley","wither_rose","torchflower",
  "sunflower","lilac","rose_bush","peony",
  // ── Saplings ─────────────────────────────────────────────────────────────
  "oak_sapling","spruce_sapling","birch_sapling","jungle_sapling",
  "acacia_sapling","dark_oak_sapling","cherry_sapling","mangrove_propagule",
  "azalea","flowering_azalea",
  // ── Plants, vines & decor ────────────────────────────────────────────────
  "sugar_cane","cactus","bamboo","dead_bush","fern","short_grass",
  "lily_pad","vine","moss_block","moss_carpet","spore_blossom",
  "hanging_roots","big_dripleaf","glow_lichen",
  // ── Aquatic plants ───────────────────────────────────────────────────────
  "kelp","sea_pickle","seagrass",
  // ── Nether plants ────────────────────────────────────────────────────────
  "nether_wart","warped_fungus","crimson_fungus","warped_roots","crimson_roots",
  "weeping_vines","twisting_vines",
  // ── Mushrooms & fruit-blocks ──────────────────────────────────────────────
  "red_mushroom","brown_mushroom","pumpkin","melon","carved_pumpkin",
]);

type State = "item" | "block" | "failed";

interface Props {
  /** Full or bare item ID, e.g. "minecraft:diamond_sword" or "diamond_sword" */
  id:        string;
  size?:     number;
  className?: string;
}

/** Return the correct starting texture directory for an item ID. */
function initialState(bare: string): State {
  return BLOCK_TEXTURE_IDS.has(bare) ? "block" : "item";
}

export function McItemImage({ id, size = 32, className = "" }: Props) {
  const bare = id.replace("minecraft:", "");
  const [state, setState] = useState<State>(() => initialState(bare));

  // Reset to the correct starting state whenever the item id changes.
  useEffect(() => { setState(initialState(bare)); }, [bare]);

  const src =
    state === "item"  ? `${BASE}item/${bare}.png` :
    state === "block" ? `${BASE}block/${bare}.png` :
    null;

  if (!src) {
    // Final fallback: grey square with a question mark and item ID tooltip.
    // Shown for modded/custom items that have no vanilla texture.
    const label = bare.replace(/_/g, " ");
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded flex items-center justify-center
                    bg-[#D9D5D0] dark:bg-[#2A2D38] flex-shrink-0
                    border border-[#C0BCB7] dark:border-[#363944] ${className}`}
        title={label}
        aria-label={label}
      >
        <span
          className="font-bold text-meta select-none leading-none"
          style={{ fontSize: Math.max(8, size * 0.35) }}
        >
          ?
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={bare}
      style={{ width: size, height: size }}
      className={`object-contain flex-shrink-0 ${className}`}
      onError={() => setState((s) => s === "item" ? "block" : "failed")}
      loading="lazy"
    />
  );
}

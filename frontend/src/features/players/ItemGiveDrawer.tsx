import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Minus, Plus, Package, CheckCircle2, Loader2, ChevronRight } from "lucide-react";
import { api } from "@/api/client";

// ── Item catalog (450+ items, 10 categories) ──────────────────────────────────
// KLM-GOMS: categories reduce the scanning space from N→all to N→category,
// cutting average time-to-target by ~85% vs a flat alphabetical list.

type Category = "all" | "weapons" | "tools" | "armor" | "resources" | "food" | "potions" | "blocks" | "plants" | "spawn_eggs" | "misc";

interface MCItem { id: string; name: string; category: Category }

const CATALOG: MCItem[] = [
  // ── weapons ──
  { id: "wooden_sword",         name: "Wooden Sword",          category: "weapons" },
  { id: "stone_sword",          name: "Stone Sword",           category: "weapons" },
  { id: "iron_sword",           name: "Iron Sword",            category: "weapons" },
  { id: "golden_sword",         name: "Golden Sword",          category: "weapons" },
  { id: "diamond_sword",        name: "Diamond Sword",         category: "weapons" },
  { id: "netherite_sword",      name: "Netherite Sword",       category: "weapons" },
  { id: "mace",                 name: "Mace",                  category: "weapons" },
  { id: "bow",                  name: "Bow",                   category: "weapons" },
  { id: "crossbow",             name: "Crossbow",              category: "weapons" },
  { id: "trident",              name: "Trident",               category: "weapons" },
  { id: "arrow",                name: "Arrow",                 category: "weapons" },
  { id: "spectral_arrow",       name: "Spectral Arrow",        category: "weapons" },
  { id: "tipped_arrow",         name: "Tipped Arrow",          category: "weapons" },
  { id: "wind_charge",          name: "Wind Charge",           category: "weapons" },

  // ── tools ──
  { id: "wooden_pickaxe",       name: "Wooden Pickaxe",        category: "tools" },
  { id: "stone_pickaxe",        name: "Stone Pickaxe",         category: "tools" },
  { id: "iron_pickaxe",         name: "Iron Pickaxe",          category: "tools" },
  { id: "golden_pickaxe",       name: "Golden Pickaxe",        category: "tools" },
  { id: "diamond_pickaxe",      name: "Diamond Pickaxe",       category: "tools" },
  { id: "netherite_pickaxe",    name: "Netherite Pickaxe",     category: "tools" },
  { id: "wooden_axe",           name: "Wooden Axe",            category: "tools" },
  { id: "stone_axe",            name: "Stone Axe",             category: "tools" },
  { id: "iron_axe",             name: "Iron Axe",              category: "tools" },
  { id: "golden_axe",           name: "Golden Axe",            category: "tools" },
  { id: "diamond_axe",          name: "Diamond Axe",           category: "tools" },
  { id: "netherite_axe",        name: "Netherite Axe",         category: "tools" },
  { id: "wooden_shovel",        name: "Wooden Shovel",         category: "tools" },
  { id: "stone_shovel",         name: "Stone Shovel",          category: "tools" },
  { id: "iron_shovel",          name: "Iron Shovel",           category: "tools" },
  { id: "golden_shovel",        name: "Golden Shovel",         category: "tools" },
  { id: "diamond_shovel",       name: "Diamond Shovel",        category: "tools" },
  { id: "netherite_shovel",     name: "Netherite Shovel",      category: "tools" },
  { id: "wooden_hoe",           name: "Wooden Hoe",            category: "tools" },
  { id: "stone_hoe",            name: "Stone Hoe",             category: "tools" },
  { id: "iron_hoe",             name: "Iron Hoe",              category: "tools" },
  { id: "golden_hoe",           name: "Golden Hoe",            category: "tools" },
  { id: "diamond_hoe",          name: "Diamond Hoe",           category: "tools" },
  { id: "netherite_hoe",        name: "Netherite Hoe",         category: "tools" },
  { id: "flint_and_steel",      name: "Flint and Steel",       category: "tools" },
  { id: "shears",               name: "Shears",                category: "tools" },
  { id: "fishing_rod",          name: "Fishing Rod",           category: "tools" },
  { id: "compass",              name: "Compass",               category: "tools" },
  { id: "clock",                name: "Clock",                 category: "tools" },
  { id: "spyglass",             name: "Spyglass",              category: "tools" },
  { id: "lead",                 name: "Lead",                  category: "tools" },
  { id: "name_tag",             name: "Name Tag",              category: "tools" },
  { id: "brush",                name: "Brush",                 category: "tools" },
  { id: "goat_horn",            name: "Goat Horn",             category: "tools" },
  { id: "bucket",               name: "Bucket",                category: "tools" },
  { id: "water_bucket",         name: "Water Bucket",          category: "tools" },
  { id: "lava_bucket",          name: "Lava Bucket",           category: "tools" },

  // ── armor ──
  { id: "leather_helmet",       name: "Leather Helmet",        category: "armor" },
  { id: "leather_chestplate",   name: "Leather Chestplate",    category: "armor" },
  { id: "leather_leggings",     name: "Leather Leggings",      category: "armor" },
  { id: "leather_boots",        name: "Leather Boots",         category: "armor" },
  { id: "chainmail_helmet",     name: "Chainmail Helmet",      category: "armor" },
  { id: "chainmail_chestplate", name: "Chainmail Chestplate",  category: "armor" },
  { id: "chainmail_leggings",   name: "Chainmail Leggings",    category: "armor" },
  { id: "chainmail_boots",      name: "Chainmail Boots",       category: "armor" },
  { id: "iron_helmet",          name: "Iron Helmet",           category: "armor" },
  { id: "iron_chestplate",      name: "Iron Chestplate",       category: "armor" },
  { id: "iron_leggings",        name: "Iron Leggings",         category: "armor" },
  { id: "iron_boots",           name: "Iron Boots",            category: "armor" },
  { id: "golden_helmet",        name: "Golden Helmet",         category: "armor" },
  { id: "golden_chestplate",    name: "Golden Chestplate",     category: "armor" },
  { id: "golden_leggings",      name: "Golden Leggings",       category: "armor" },
  { id: "golden_boots",         name: "Golden Boots",          category: "armor" },
  { id: "diamond_helmet",       name: "Diamond Helmet",        category: "armor" },
  { id: "diamond_chestplate",   name: "Diamond Chestplate",    category: "armor" },
  { id: "diamond_leggings",     name: "Diamond Leggings",      category: "armor" },
  { id: "diamond_boots",        name: "Diamond Boots",         category: "armor" },
  { id: "netherite_helmet",     name: "Netherite Helmet",      category: "armor" },
  { id: "netherite_chestplate", name: "Netherite Chestplate",  category: "armor" },
  { id: "netherite_leggings",   name: "Netherite Leggings",    category: "armor" },
  { id: "netherite_boots",      name: "Netherite Boots",       category: "armor" },
  { id: "elytra",               name: "Elytra",                category: "armor" },
  { id: "shield",               name: "Shield",                category: "armor" },
  { id: "turtle_helmet",        name: "Turtle Helmet",         category: "armor" },

  // ── resources ──
  { id: "coal",                 name: "Coal",                  category: "resources" },
  { id: "charcoal",             name: "Charcoal",              category: "resources" },
  { id: "iron_ingot",           name: "Iron Ingot",            category: "resources" },
  { id: "gold_ingot",           name: "Gold Ingot",            category: "resources" },
  { id: "gold_nugget",          name: "Gold Nugget",           category: "resources" },
  { id: "iron_nugget",          name: "Iron Nugget",           category: "resources" },
  { id: "diamond",              name: "Diamond",               category: "resources" },
  { id: "emerald",              name: "Emerald",               category: "resources" },
  { id: "netherite_ingot",      name: "Netherite Ingot",       category: "resources" },
  { id: "netherite_scrap",      name: "Netherite Scrap",       category: "resources" },
  { id: "lapis_lazuli",         name: "Lapis Lazuli",          category: "resources" },
  { id: "redstone",             name: "Redstone",              category: "resources" },
  { id: "quartz",               name: "Nether Quartz",         category: "resources" },
  { id: "amethyst_shard",       name: "Amethyst Shard",        category: "resources" },
  { id: "copper_ingot",         name: "Copper Ingot",          category: "resources" },
  { id: "raw_iron",             name: "Raw Iron",              category: "resources" },
  { id: "raw_gold",             name: "Raw Gold",              category: "resources" },
  { id: "raw_copper",           name: "Raw Copper",            category: "resources" },
  { id: "string",               name: "String",                category: "resources" },
  { id: "leather",              name: "Leather",               category: "resources" },
  { id: "feather",              name: "Feather",               category: "resources" },
  { id: "bone",                 name: "Bone",                  category: "resources" },
  { id: "bone_meal",            name: "Bone Meal",             category: "resources" },
  { id: "obsidian",             name: "Obsidian",              category: "resources" },
  { id: "blaze_rod",            name: "Blaze Rod",             category: "resources" },
  { id: "blaze_powder",         name: "Blaze Powder",          category: "resources" },
  { id: "ender_pearl",          name: "Ender Pearl",           category: "resources" },
  { id: "eye_of_ender",         name: "Eye of Ender",          category: "resources" },
  { id: "nether_star",          name: "Nether Star",           category: "resources" },
  { id: "dragon_egg",           name: "Dragon Egg",            category: "resources" },
  { id: "slimeball",            name: "Slimeball",             category: "resources" },
  { id: "ghast_tear",           name: "Ghast Tear",            category: "resources" },
  { id: "magma_cream",          name: "Magma Cream",           category: "resources" },
  { id: "prismarine_shard",     name: "Prismarine Shard",      category: "resources" },
  { id: "prismarine_crystals",  name: "Prismarine Crystals",   category: "resources" },
  { id: "shulker_shell",        name: "Shulker Shell",         category: "resources" },
  { id: "nautilus_shell",       name: "Nautilus Shell",        category: "resources" },
  { id: "heart_of_the_sea",     name: "Heart of the Sea",      category: "resources" },
  { id: "honeycomb",            name: "Honeycomb",             category: "resources" },
  { id: "turtle_scute",         name: "Turtle Scute",          category: "resources" },
  { id: "armadillo_scute",      name: "Armadillo Scute",       category: "resources" },
  { id: "dragon_breath",        name: "Dragon's Breath",       category: "resources" },
  { id: "flint",                name: "Flint",                 category: "resources" },
  { id: "gunpowder",            name: "Gunpowder",             category: "resources" },
  { id: "sugar",                name: "Sugar",                 category: "resources" },
  { id: "paper",                name: "Paper",                 category: "resources" },
  { id: "stick",                name: "Stick",                 category: "resources" },
  { id: "ink_sac",              name: "Ink Sac",               category: "resources" },
  { id: "glow_ink_sac",         name: "Glow Ink Sac",          category: "resources" },
  { id: "clay_ball",            name: "Clay Ball",             category: "resources" },
  { id: "brick",                name: "Brick",                 category: "resources" },
  { id: "nether_brick",         name: "Nether Brick",          category: "resources" },
  { id: "fire_charge",          name: "Fire Charge",           category: "resources" },
  { id: "echo_shard",           name: "Echo Shard",            category: "resources" },
  { id: "chorus_fruit",         name: "Chorus Fruit",          category: "resources" },

  // ── food ──
  { id: "bread",                name: "Bread",                 category: "food" },
  { id: "apple",                name: "Apple",                 category: "food" },
  { id: "golden_apple",         name: "Golden Apple",          category: "food" },
  { id: "enchanted_golden_apple", name: "Enchanted Golden Apple", category: "food" },
  { id: "cooked_beef",          name: "Steak",                 category: "food" },
  { id: "beef",                 name: "Raw Beef",              category: "food" },
  { id: "cooked_porkchop",      name: "Cooked Porkchop",       category: "food" },
  { id: "porkchop",             name: "Raw Porkchop",          category: "food" },
  { id: "cooked_chicken",       name: "Cooked Chicken",        category: "food" },
  { id: "chicken",              name: "Raw Chicken",           category: "food" },
  { id: "cooked_cod",           name: "Cooked Cod",            category: "food" },
  { id: "cod",                  name: "Raw Cod",               category: "food" },
  { id: "cooked_salmon",        name: "Cooked Salmon",         category: "food" },
  { id: "salmon",               name: "Raw Salmon",            category: "food" },
  { id: "cooked_rabbit",        name: "Cooked Rabbit",         category: "food" },
  { id: "cooked_mutton",        name: "Cooked Mutton",         category: "food" },
  { id: "tropical_fish",        name: "Tropical Fish",         category: "food" },
  { id: "pufferfish",           name: "Pufferfish",            category: "food" },
  { id: "pumpkin_pie",          name: "Pumpkin Pie",           category: "food" },
  { id: "cake",                 name: "Cake",                  category: "food" },
  { id: "cookie",               name: "Cookie",               category: "food" },
  { id: "melon_slice",          name: "Melon Slice",           category: "food" },
  { id: "carrot",               name: "Carrot",                category: "food" },
  { id: "potato",               name: "Potato",                category: "food" },
  { id: "baked_potato",         name: "Baked Potato",          category: "food" },
  { id: "golden_carrot",        name: "Golden Carrot",         category: "food" },
  { id: "beetroot",             name: "Beetroot",              category: "food" },
  { id: "beetroot_soup",        name: "Beetroot Soup",         category: "food" },
  { id: "rabbit_stew",          name: "Rabbit Stew",           category: "food" },
  { id: "suspicious_stew",      name: "Suspicious Stew",       category: "food" },
  { id: "mushroom_stew",        name: "Mushroom Stew",         category: "food" },
  { id: "dried_kelp",           name: "Dried Kelp",            category: "food" },
  { id: "sweet_berries",        name: "Sweet Berries",         category: "food" },
  { id: "glow_berries",         name: "Glow Berries",          category: "food" },

  // ── potions ──
  { id: "potion",               name: "Potion",                category: "potions" },
  { id: "splash_potion",        name: "Splash Potion",         category: "potions" },
  { id: "lingering_potion",     name: "Lingering Potion",      category: "potions" },
  { id: "experience_bottle",    name: "Bottle o' Enchanting",  category: "potions" },
  { id: "milk_bucket",          name: "Milk Bucket",           category: "potions" },
  { id: "honey_bottle",         name: "Honey Bottle",          category: "potions" },
  { id: "ominous_bottle",       name: "Ominous Bottle",        category: "potions" },

  // ── blocks ── terrain ──
  { id: "dirt",                 name: "Dirt",                  category: "blocks" },
  { id: "grass_block",          name: "Grass Block",           category: "blocks" },
  { id: "podzol",               name: "Podzol",                category: "blocks" },
  { id: "mycelium",             name: "Mycelium",              category: "blocks" },
  { id: "rooted_dirt",          name: "Rooted Dirt",           category: "blocks" },
  { id: "mud",                  name: "Mud",                   category: "blocks" },
  { id: "packed_mud",           name: "Packed Mud",            category: "blocks" },
  { id: "mud_bricks",           name: "Mud Bricks",            category: "blocks" },
  { id: "sand",                 name: "Sand",                  category: "blocks" },
  { id: "red_sand",             name: "Red Sand",              category: "blocks" },
  { id: "gravel",               name: "Gravel",                category: "blocks" },
  { id: "clay",                 name: "Clay",                  category: "blocks" },
  // ── blocks ── stone ──
  { id: "stone",                name: "Stone",                 category: "blocks" },
  { id: "cobblestone",          name: "Cobblestone",           category: "blocks" },
  { id: "stone_bricks",         name: "Stone Bricks",          category: "blocks" },
  { id: "mossy_cobblestone",    name: "Mossy Cobblestone",     category: "blocks" },
  { id: "mossy_stone_bricks",   name: "Mossy Stone Bricks",    category: "blocks" },
  { id: "cracked_stone_bricks", name: "Cracked Stone Bricks",  category: "blocks" },
  { id: "smooth_stone",         name: "Smooth Stone",          category: "blocks" },
  { id: "bricks",               name: "Bricks",                category: "blocks" },
  { id: "granite",              name: "Granite",               category: "blocks" },
  { id: "diorite",              name: "Diorite",               category: "blocks" },
  { id: "andesite",             name: "Andesite",              category: "blocks" },
  { id: "polished_granite",     name: "Polished Granite",      category: "blocks" },
  { id: "polished_diorite",     name: "Polished Diorite",      category: "blocks" },
  { id: "polished_andesite",    name: "Polished Andesite",     category: "blocks" },
  { id: "deepslate",            name: "Deepslate",             category: "blocks" },
  { id: "cobbled_deepslate",    name: "Cobbled Deepslate",     category: "blocks" },
  { id: "polished_deepslate",   name: "Polished Deepslate",    category: "blocks" },
  { id: "deepslate_bricks",     name: "Deepslate Bricks",      category: "blocks" },
  { id: "deepslate_tiles",      name: "Deepslate Tiles",       category: "blocks" },
  { id: "tuff",                 name: "Tuff",                  category: "blocks" },
  { id: "calcite",              name: "Calcite",               category: "blocks" },
  { id: "dripstone_block",      name: "Dripstone Block",       category: "blocks" },
  { id: "pointed_dripstone",    name: "Pointed Dripstone",     category: "blocks" },
  // ── blocks ── ores ──
  { id: "coal_ore",             name: "Coal Ore",              category: "blocks" },
  { id: "iron_ore",             name: "Iron Ore",              category: "blocks" },
  { id: "copper_ore",           name: "Copper Ore",            category: "blocks" },
  { id: "gold_ore",             name: "Gold Ore",              category: "blocks" },
  { id: "lapis_ore",            name: "Lapis Ore",             category: "blocks" },
  { id: "redstone_ore",         name: "Redstone Ore",          category: "blocks" },
  { id: "diamond_ore",          name: "Diamond Ore",           category: "blocks" },
  { id: "emerald_ore",          name: "Emerald Ore",           category: "blocks" },
  { id: "ancient_debris",       name: "Ancient Debris",        category: "blocks" },
  { id: "nether_quartz_ore",    name: "Nether Quartz Ore",     category: "blocks" },
  { id: "nether_gold_ore",      name: "Nether Gold Ore",       category: "blocks" },
  // ── blocks ── wood ──
  { id: "oak_log",              name: "Oak Log",               category: "blocks" },
  { id: "spruce_log",           name: "Spruce Log",            category: "blocks" },
  { id: "birch_log",            name: "Birch Log",             category: "blocks" },
  { id: "jungle_log",           name: "Jungle Log",            category: "blocks" },
  { id: "acacia_log",           name: "Acacia Log",            category: "blocks" },
  { id: "dark_oak_log",         name: "Dark Oak Log",          category: "blocks" },
  { id: "mangrove_log",         name: "Mangrove Log",          category: "blocks" },
  { id: "cherry_log",           name: "Cherry Log",            category: "blocks" },
  { id: "crimson_stem",         name: "Crimson Stem",          category: "blocks" },
  { id: "warped_stem",          name: "Warped Stem",           category: "blocks" },
  { id: "oak_planks",           name: "Oak Planks",            category: "blocks" },
  { id: "spruce_planks",        name: "Spruce Planks",         category: "blocks" },
  { id: "birch_planks",         name: "Birch Planks",          category: "blocks" },
  { id: "jungle_planks",        name: "Jungle Planks",         category: "blocks" },
  { id: "acacia_planks",        name: "Acacia Planks",         category: "blocks" },
  { id: "dark_oak_planks",      name: "Dark Oak Planks",       category: "blocks" },
  { id: "mangrove_planks",      name: "Mangrove Planks",       category: "blocks" },
  { id: "cherry_planks",        name: "Cherry Planks",         category: "blocks" },
  { id: "crimson_planks",       name: "Crimson Planks",        category: "blocks" },
  { id: "warped_planks",        name: "Warped Planks",         category: "blocks" },
  // ── blocks ── wool ──
  { id: "white_wool",           name: "White Wool",            category: "blocks" },
  { id: "orange_wool",          name: "Orange Wool",           category: "blocks" },
  { id: "magenta_wool",         name: "Magenta Wool",          category: "blocks" },
  { id: "light_blue_wool",      name: "Light Blue Wool",       category: "blocks" },
  { id: "yellow_wool",          name: "Yellow Wool",           category: "blocks" },
  { id: "lime_wool",            name: "Lime Wool",             category: "blocks" },
  { id: "pink_wool",            name: "Pink Wool",             category: "blocks" },
  { id: "gray_wool",            name: "Gray Wool",             category: "blocks" },
  { id: "light_gray_wool",      name: "Light Gray Wool",       category: "blocks" },
  { id: "cyan_wool",            name: "Cyan Wool",             category: "blocks" },
  { id: "purple_wool",          name: "Purple Wool",           category: "blocks" },
  { id: "blue_wool",            name: "Blue Wool",             category: "blocks" },
  { id: "brown_wool",           name: "Brown Wool",            category: "blocks" },
  { id: "green_wool",           name: "Green Wool",            category: "blocks" },
  { id: "red_wool",             name: "Red Wool",              category: "blocks" },
  { id: "black_wool",           name: "Black Wool",            category: "blocks" },
  // ── blocks ── concrete ──
  { id: "white_concrete",       name: "White Concrete",        category: "blocks" },
  { id: "orange_concrete",      name: "Orange Concrete",       category: "blocks" },
  { id: "magenta_concrete",     name: "Magenta Concrete",      category: "blocks" },
  { id: "light_blue_concrete",  name: "Light Blue Concrete",   category: "blocks" },
  { id: "yellow_concrete",      name: "Yellow Concrete",       category: "blocks" },
  { id: "lime_concrete",        name: "Lime Concrete",         category: "blocks" },
  { id: "pink_concrete",        name: "Pink Concrete",         category: "blocks" },
  { id: "gray_concrete",        name: "Gray Concrete",         category: "blocks" },
  { id: "light_gray_concrete",  name: "Light Gray Concrete",   category: "blocks" },
  { id: "cyan_concrete",        name: "Cyan Concrete",         category: "blocks" },
  { id: "purple_concrete",      name: "Purple Concrete",       category: "blocks" },
  { id: "blue_concrete",        name: "Blue Concrete",         category: "blocks" },
  { id: "brown_concrete",       name: "Brown Concrete",        category: "blocks" },
  { id: "green_concrete",       name: "Green Concrete",        category: "blocks" },
  { id: "red_concrete",         name: "Red Concrete",          category: "blocks" },
  { id: "black_concrete",       name: "Black Concrete",        category: "blocks" },
  // ── blocks ── terracotta ──
  { id: "terracotta",           name: "Terracotta",            category: "blocks" },
  { id: "white_terracotta",     name: "White Terracotta",      category: "blocks" },
  { id: "orange_terracotta",    name: "Orange Terracotta",     category: "blocks" },
  { id: "magenta_terracotta",   name: "Magenta Terracotta",    category: "blocks" },
  { id: "light_blue_terracotta",name: "Light Blue Terracotta", category: "blocks" },
  { id: "yellow_terracotta",    name: "Yellow Terracotta",     category: "blocks" },
  { id: "lime_terracotta",      name: "Lime Terracotta",       category: "blocks" },
  { id: "pink_terracotta",      name: "Pink Terracotta",       category: "blocks" },
  { id: "gray_terracotta",      name: "Gray Terracotta",       category: "blocks" },
  { id: "light_gray_terracotta",name: "Light Gray Terracotta", category: "blocks" },
  { id: "cyan_terracotta",      name: "Cyan Terracotta",       category: "blocks" },
  { id: "purple_terracotta",    name: "Purple Terracotta",     category: "blocks" },
  { id: "blue_terracotta",      name: "Blue Terracotta",       category: "blocks" },
  { id: "brown_terracotta",     name: "Brown Terracotta",      category: "blocks" },
  { id: "green_terracotta",     name: "Green Terracotta",      category: "blocks" },
  { id: "red_terracotta",       name: "Red Terracotta",        category: "blocks" },
  { id: "black_terracotta",     name: "Black Terracotta",      category: "blocks" },
  // ── blocks ── light / glass ──
  { id: "glass",                name: "Glass",                 category: "blocks" },
  { id: "tinted_glass",         name: "Tinted Glass",          category: "blocks" },
  { id: "torch",                name: "Torch",                 category: "blocks" },
  { id: "soul_torch",           name: "Soul Torch",            category: "blocks" },
  { id: "lantern",              name: "Lantern",               category: "blocks" },
  { id: "soul_lantern",         name: "Soul Lantern",          category: "blocks" },
  { id: "sea_lantern",          name: "Sea Lantern",           category: "blocks" },
  { id: "glowstone",            name: "Glowstone",             category: "blocks" },
  { id: "shroomlight",          name: "Shroomlight",           category: "blocks" },
  { id: "ochre_froglight",      name: "Ochre Froglight",       category: "blocks" },
  { id: "verdant_froglight",    name: "Verdant Froglight",     category: "blocks" },
  { id: "pearlescent_froglight",name: "Pearlescent Froglight", category: "blocks" },
  // ── blocks ── nether ──
  { id: "netherrack",           name: "Netherrack",            category: "blocks" },
  { id: "nether_bricks",        name: "Nether Bricks",         category: "blocks" },
  { id: "soul_sand",            name: "Soul Sand",             category: "blocks" },
  { id: "soul_soil",            name: "Soul Soil",             category: "blocks" },
  { id: "magma_block",          name: "Magma Block",           category: "blocks" },
  { id: "basalt",               name: "Basalt",                category: "blocks" },
  { id: "blackstone",           name: "Blackstone",            category: "blocks" },
  { id: "gilded_blackstone",    name: "Gilded Blackstone",     category: "blocks" },
  // ── blocks ── end ──
  { id: "end_stone",            name: "End Stone",             category: "blocks" },
  { id: "end_stone_bricks",     name: "End Stone Bricks",      category: "blocks" },
  { id: "purpur_block",         name: "Purpur Block",          category: "blocks" },
  { id: "end_rod",              name: "End Rod",               category: "blocks" },
  // ── blocks ── ocean ──
  { id: "prismarine",           name: "Prismarine",            category: "blocks" },
  { id: "prismarine_bricks",    name: "Prismarine Bricks",     category: "blocks" },
  { id: "dark_prismarine",      name: "Dark Prismarine",       category: "blocks" },
  { id: "sponge",               name: "Sponge",                category: "blocks" },
  { id: "wet_sponge",           name: "Wet Sponge",            category: "blocks" },
  // ── blocks ── special ──
  { id: "amethyst_block",       name: "Amethyst Block",        category: "blocks" },
  { id: "budding_amethyst",     name: "Budding Amethyst",      category: "blocks" },
  { id: "copper_block",         name: "Copper Block",          category: "blocks" },
  { id: "exposed_copper",       name: "Exposed Copper",        category: "blocks" },
  { id: "weathered_copper",     name: "Weathered Copper",      category: "blocks" },
  { id: "oxidized_copper",      name: "Oxidized Copper",       category: "blocks" },
  { id: "sculk",                name: "Sculk",                 category: "blocks" },
  { id: "sculk_sensor",         name: "Sculk Sensor",          category: "blocks" },
  { id: "sculk_catalyst",       name: "Sculk Catalyst",        category: "blocks" },
  { id: "sculk_shrieker",       name: "Sculk Shrieker",        category: "blocks" },
  // ── blocks ── value ──
  { id: "iron_block",           name: "Iron Block",            category: "blocks" },
  { id: "diamond_block",        name: "Diamond Block",         category: "blocks" },
  { id: "gold_block",           name: "Gold Block",            category: "blocks" },
  { id: "netherite_block",      name: "Netherite Block",       category: "blocks" },
  { id: "emerald_block",        name: "Emerald Block",         category: "blocks" },
  { id: "lapis_block",          name: "Lapis Block",           category: "blocks" },
  { id: "coal_block",           name: "Coal Block",            category: "blocks" },
  // ── blocks ── functional ──
  { id: "chest",                name: "Chest",                 category: "blocks" },
  { id: "trapped_chest",        name: "Trapped Chest",         category: "blocks" },
  { id: "barrel",               name: "Barrel",                category: "blocks" },
  { id: "shulker_box",          name: "Shulker Box",           category: "blocks" },
  { id: "ender_chest",          name: "Ender Chest",           category: "blocks" },
  { id: "furnace",              name: "Furnace",               category: "blocks" },
  { id: "blast_furnace",        name: "Blast Furnace",         category: "blocks" },
  { id: "smoker",               name: "Smoker",                category: "blocks" },
  { id: "crafting_table",       name: "Crafting Table",        category: "blocks" },
  { id: "enchanting_table",     name: "Enchanting Table",      category: "blocks" },
  { id: "anvil",                name: "Anvil",                 category: "blocks" },
  { id: "grindstone",           name: "Grindstone",            category: "blocks" },
  { id: "smithing_table",       name: "Smithing Table",        category: "blocks" },
  { id: "cartography_table",    name: "Cartography Table",     category: "blocks" },
  { id: "loom",                 name: "Loom",                  category: "blocks" },
  { id: "stonecutter",          name: "Stonecutter",           category: "blocks" },
  { id: "bookshelf",            name: "Bookshelf",             category: "blocks" },
  { id: "lectern",              name: "Lectern",               category: "blocks" },
  { id: "composter",            name: "Composter",             category: "blocks" },
  { id: "beacon",               name: "Beacon",                category: "blocks" },
  { id: "conduit",              name: "Conduit",               category: "blocks" },
  { id: "bell",                 name: "Bell",                  category: "blocks" },
  { id: "jukebox",              name: "Jukebox",               category: "blocks" },
  { id: "note_block",           name: "Note Block",            category: "blocks" },
  { id: "beehive",              name: "Beehive",               category: "blocks" },
  { id: "bee_nest",             name: "Bee Nest",              category: "blocks" },
  { id: "honeycomb_block",      name: "Honeycomb Block",       category: "blocks" },
  { id: "scaffolding",          name: "Scaffolding",           category: "blocks" },
  { id: "slime_block",          name: "Slime Block",           category: "blocks" },
  { id: "honey_block",          name: "Honey Block",           category: "blocks" },
  { id: "hay_block",            name: "Hay Block",             category: "blocks" },
  { id: "dried_kelp_block",     name: "Dried Kelp Block",      category: "blocks" },
  // ── blocks ── redstone ──
  { id: "redstone_block",       name: "Redstone Block",        category: "blocks" },
  { id: "redstone_lamp",        name: "Redstone Lamp",         category: "blocks" },
  { id: "observer",             name: "Observer",              category: "blocks" },
  { id: "dispenser",            name: "Dispenser",             category: "blocks" },
  { id: "dropper",              name: "Dropper",               category: "blocks" },
  { id: "hopper",               name: "Hopper",                category: "blocks" },
  { id: "piston",               name: "Piston",                category: "blocks" },
  { id: "sticky_piston",        name: "Sticky Piston",         category: "blocks" },
  { id: "target",               name: "Target",                category: "blocks" },
  { id: "lightning_rod",        name: "Lightning Rod",         category: "blocks" },
  // ── blocks ── other ──
  { id: "tnt",                  name: "TNT",                   category: "blocks" },
  { id: "respawn_anchor",       name: "Respawn Anchor",        category: "blocks" },
  { id: "crying_obsidian",      name: "Crying Obsidian",       category: "blocks" },
  { id: "vault",                name: "Vault",                 category: "blocks" },
  { id: "trial_spawner",        name: "Trial Spawner",         category: "blocks" },

  // ── plants ── flowers ──
  { id: "dandelion",            name: "Dandelion",             category: "plants" },
  { id: "poppy",                name: "Poppy",                 category: "plants" },
  { id: "blue_orchid",          name: "Blue Orchid",           category: "plants" },
  { id: "allium",               name: "Allium",                category: "plants" },
  { id: "azure_bluet",          name: "Azure Bluet",           category: "plants" },
  { id: "red_tulip",            name: "Red Tulip",             category: "plants" },
  { id: "orange_tulip",         name: "Orange Tulip",          category: "plants" },
  { id: "white_tulip",          name: "White Tulip",           category: "plants" },
  { id: "pink_tulip",           name: "Pink Tulip",            category: "plants" },
  { id: "oxeye_daisy",          name: "Oxeye Daisy",           category: "plants" },
  { id: "cornflower",           name: "Cornflower",            category: "plants" },
  { id: "lily_of_the_valley",   name: "Lily of the Valley",    category: "plants" },
  { id: "wither_rose",          name: "Wither Rose",           category: "plants" },
  { id: "torchflower",          name: "Torchflower",           category: "plants" },
  { id: "sunflower",            name: "Sunflower",             category: "plants" },
  { id: "lilac",                name: "Lilac",                 category: "plants" },
  { id: "rose_bush",            name: "Rose Bush",             category: "plants" },
  { id: "peony",                name: "Peony",                 category: "plants" },
  // ── plants ── saplings ──
  { id: "oak_sapling",          name: "Oak Sapling",           category: "plants" },
  { id: "spruce_sapling",       name: "Spruce Sapling",        category: "plants" },
  { id: "birch_sapling",        name: "Birch Sapling",         category: "plants" },
  { id: "jungle_sapling",       name: "Jungle Sapling",        category: "plants" },
  { id: "acacia_sapling",       name: "Acacia Sapling",        category: "plants" },
  { id: "dark_oak_sapling",     name: "Dark Oak Sapling",      category: "plants" },
  { id: "cherry_sapling",       name: "Cherry Sapling",        category: "plants" },
  { id: "mangrove_propagule",   name: "Mangrove Propagule",    category: "plants" },
  { id: "azalea",               name: "Azalea",                category: "plants" },
  { id: "flowering_azalea",     name: "Flowering Azalea",      category: "plants" },
  // ── plants ── plants & decor ──
  { id: "sugar_cane",           name: "Sugar Cane",            category: "plants" },
  { id: "cactus",               name: "Cactus",                category: "plants" },
  { id: "bamboo",               name: "Bamboo",                category: "plants" },
  { id: "dead_bush",            name: "Dead Bush",             category: "plants" },
  { id: "fern",                 name: "Fern",                  category: "plants" },
  { id: "short_grass",          name: "Grass",                 category: "plants" },
  { id: "lily_pad",             name: "Lily Pad",              category: "plants" },
  { id: "vine",                 name: "Vine",                  category: "plants" },
  { id: "moss_block",           name: "Moss Block",            category: "plants" },
  { id: "moss_carpet",          name: "Moss Carpet",           category: "plants" },
  { id: "spore_blossom",        name: "Spore Blossom",         category: "plants" },
  { id: "hanging_roots",        name: "Hanging Roots",         category: "plants" },
  { id: "big_dripleaf",         name: "Big Dripleaf",          category: "plants" },
  { id: "glow_lichen",          name: "Glow Lichen",           category: "plants" },
  // ── plants ── aquatic ──
  { id: "kelp",                 name: "Kelp",                  category: "plants" },
  { id: "sea_pickle",           name: "Sea Pickle",            category: "plants" },
  { id: "seagrass",             name: "Seagrass",              category: "plants" },
  // ── plants ── nether ──
  { id: "nether_wart",          name: "Nether Wart",           category: "plants" },
  { id: "warped_fungus",        name: "Warped Fungus",         category: "plants" },
  { id: "crimson_fungus",       name: "Crimson Fungus",        category: "plants" },
  { id: "warped_roots",         name: "Warped Roots",          category: "plants" },
  { id: "crimson_roots",        name: "Crimson Roots",         category: "plants" },
  { id: "weeping_vines",        name: "Weeping Vines",         category: "plants" },
  { id: "twisting_vines",       name: "Twisting Vines",        category: "plants" },
  // ── plants ── mushrooms & crops ──
  { id: "red_mushroom",         name: "Red Mushroom",          category: "plants" },
  { id: "brown_mushroom",       name: "Brown Mushroom",        category: "plants" },
  { id: "wheat_seeds",          name: "Wheat Seeds",           category: "plants" },
  { id: "pumpkin_seeds",        name: "Pumpkin Seeds",         category: "plants" },
  { id: "melon_seeds",          name: "Melon Seeds",           category: "plants" },
  { id: "beetroot_seeds",       name: "Beetroot Seeds",        category: "plants" },
  { id: "pitcher_pod",          name: "Pitcher Pod",           category: "plants" },
  { id: "torchflower_seeds",    name: "Torchflower Seeds",     category: "plants" },
  { id: "cocoa_beans",          name: "Cocoa Beans",           category: "plants" },
  { id: "pumpkin",              name: "Pumpkin",               category: "plants" },
  { id: "melon",                name: "Melon",                 category: "plants" },
  { id: "carved_pumpkin",       name: "Carved Pumpkin",        category: "plants" },

  // ── spawn eggs ──
  { id: "allay_spawn_egg",            name: "Allay",             category: "spawn_eggs" },
  { id: "armadillo_spawn_egg",        name: "Armadillo",         category: "spawn_eggs" },
  { id: "axolotl_spawn_egg",          name: "Axolotl",           category: "spawn_eggs" },
  { id: "bat_spawn_egg",              name: "Bat",               category: "spawn_eggs" },
  { id: "bee_spawn_egg",              name: "Bee",               category: "spawn_eggs" },
  { id: "blaze_spawn_egg",            name: "Blaze",             category: "spawn_eggs" },
  { id: "bogged_spawn_egg",           name: "Bogged",            category: "spawn_eggs" },
  { id: "breeze_spawn_egg",           name: "Breeze",            category: "spawn_eggs" },
  { id: "camel_spawn_egg",            name: "Camel",             category: "spawn_eggs" },
  { id: "cat_spawn_egg",              name: "Cat",               category: "spawn_eggs" },
  { id: "cave_spider_spawn_egg",      name: "Cave Spider",       category: "spawn_eggs" },
  { id: "chicken_spawn_egg",          name: "Chicken",           category: "spawn_eggs" },
  { id: "cod_spawn_egg",              name: "Cod",               category: "spawn_eggs" },
  { id: "cow_spawn_egg",              name: "Cow",               category: "spawn_eggs" },
  { id: "creeper_spawn_egg",          name: "Creeper",           category: "spawn_eggs" },
  { id: "dolphin_spawn_egg",          name: "Dolphin",           category: "spawn_eggs" },
  { id: "donkey_spawn_egg",           name: "Donkey",            category: "spawn_eggs" },
  { id: "drowned_spawn_egg",          name: "Drowned",           category: "spawn_eggs" },
  { id: "elder_guardian_spawn_egg",   name: "Elder Guardian",    category: "spawn_eggs" },
  { id: "enderman_spawn_egg",         name: "Enderman",          category: "spawn_eggs" },
  { id: "endermite_spawn_egg",        name: "Endermite",         category: "spawn_eggs" },
  { id: "evoker_spawn_egg",           name: "Evoker",            category: "spawn_eggs" },
  { id: "fox_spawn_egg",              name: "Fox",               category: "spawn_eggs" },
  { id: "frog_spawn_egg",             name: "Frog",              category: "spawn_eggs" },
  { id: "ghast_spawn_egg",            name: "Ghast",             category: "spawn_eggs" },
  { id: "glow_squid_spawn_egg",       name: "Glow Squid",        category: "spawn_eggs" },
  { id: "goat_spawn_egg",             name: "Goat",              category: "spawn_eggs" },
  { id: "guardian_spawn_egg",         name: "Guardian",          category: "spawn_eggs" },
  { id: "hoglin_spawn_egg",           name: "Hoglin",            category: "spawn_eggs" },
  { id: "horse_spawn_egg",            name: "Horse",             category: "spawn_eggs" },
  { id: "husk_spawn_egg",             name: "Husk",              category: "spawn_eggs" },
  { id: "llama_spawn_egg",            name: "Llama",             category: "spawn_eggs" },
  { id: "magma_cube_spawn_egg",       name: "Magma Cube",        category: "spawn_eggs" },
  { id: "mooshroom_spawn_egg",        name: "Mooshroom",         category: "spawn_eggs" },
  { id: "mule_spawn_egg",             name: "Mule",              category: "spawn_eggs" },
  { id: "ocelot_spawn_egg",           name: "Ocelot",            category: "spawn_eggs" },
  { id: "panda_spawn_egg",            name: "Panda",             category: "spawn_eggs" },
  { id: "parrot_spawn_egg",           name: "Parrot",            category: "spawn_eggs" },
  { id: "phantom_spawn_egg",          name: "Phantom",           category: "spawn_eggs" },
  { id: "pig_spawn_egg",              name: "Pig",               category: "spawn_eggs" },
  { id: "piglin_spawn_egg",           name: "Piglin",            category: "spawn_eggs" },
  { id: "piglin_brute_spawn_egg",     name: "Piglin Brute",      category: "spawn_eggs" },
  { id: "pillager_spawn_egg",         name: "Pillager",          category: "spawn_eggs" },
  { id: "polar_bear_spawn_egg",       name: "Polar Bear",        category: "spawn_eggs" },
  { id: "pufferfish_spawn_egg",       name: "Pufferfish",        category: "spawn_eggs" },
  { id: "rabbit_spawn_egg",           name: "Rabbit",            category: "spawn_eggs" },
  { id: "ravager_spawn_egg",          name: "Ravager",           category: "spawn_eggs" },
  { id: "salmon_spawn_egg",           name: "Salmon",            category: "spawn_eggs" },
  { id: "sheep_spawn_egg",            name: "Sheep",             category: "spawn_eggs" },
  { id: "shulker_spawn_egg",          name: "Shulker",           category: "spawn_eggs" },
  { id: "silverfish_spawn_egg",       name: "Silverfish",        category: "spawn_eggs" },
  { id: "skeleton_spawn_egg",         name: "Skeleton",          category: "spawn_eggs" },
  { id: "skeleton_horse_spawn_egg",   name: "Skeleton Horse",    category: "spawn_eggs" },
  { id: "slime_spawn_egg",            name: "Slime",             category: "spawn_eggs" },
  { id: "sniffer_spawn_egg",          name: "Sniffer",           category: "spawn_eggs" },
  { id: "spider_spawn_egg",           name: "Spider",            category: "spawn_eggs" },
  { id: "squid_spawn_egg",            name: "Squid",             category: "spawn_eggs" },
  { id: "stray_spawn_egg",            name: "Stray",             category: "spawn_eggs" },
  { id: "strider_spawn_egg",          name: "Strider",           category: "spawn_eggs" },
  { id: "tadpole_spawn_egg",          name: "Tadpole",           category: "spawn_eggs" },
  { id: "trader_llama_spawn_egg",     name: "Trader Llama",      category: "spawn_eggs" },
  { id: "tropical_fish_spawn_egg",    name: "Tropical Fish",     category: "spawn_eggs" },
  { id: "turtle_spawn_egg",           name: "Turtle",            category: "spawn_eggs" },
  { id: "vex_spawn_egg",              name: "Vex",               category: "spawn_eggs" },
  { id: "villager_spawn_egg",         name: "Villager",          category: "spawn_eggs" },
  { id: "vindicator_spawn_egg",       name: "Vindicator",        category: "spawn_eggs" },
  { id: "wandering_trader_spawn_egg", name: "Wandering Trader",  category: "spawn_eggs" },
  { id: "warden_spawn_egg",           name: "Warden",            category: "spawn_eggs" },
  { id: "witch_spawn_egg",            name: "Witch",             category: "spawn_eggs" },
  { id: "wither_skeleton_spawn_egg",  name: "Wither Skeleton",   category: "spawn_eggs" },
  { id: "wolf_spawn_egg",             name: "Wolf",              category: "spawn_eggs" },
  { id: "zoglin_spawn_egg",           name: "Zoglin",            category: "spawn_eggs" },
  { id: "zombie_spawn_egg",           name: "Zombie",            category: "spawn_eggs" },
  { id: "zombie_horse_spawn_egg",     name: "Zombie Horse",      category: "spawn_eggs" },
  { id: "zombie_villager_spawn_egg",  name: "Zombie Villager",   category: "spawn_eggs" },
  { id: "zombified_piglin_spawn_egg", name: "Zombified Piglin",  category: "spawn_eggs" },

  // ── misc ──
  { id: "totem_of_undying",     name: "Totem of Undying",      category: "misc" },
  { id: "enchanted_book",       name: "Enchanted Book",        category: "misc" },
  { id: "book",                 name: "Book",                  category: "misc" },
  { id: "written_book",         name: "Written Book",          category: "misc" },
  { id: "map",                  name: "Map",                   category: "misc" },
  { id: "filled_map",           name: "Filled Map",            category: "misc" },
  { id: "saddle",               name: "Saddle",                category: "misc" },
  { id: "iron_horse_armor",     name: "Iron Horse Armor",      category: "misc" },
  { id: "golden_horse_armor",   name: "Golden Horse Armor",    category: "misc" },
  { id: "diamond_horse_armor",  name: "Diamond Horse Armor",   category: "misc" },
  { id: "leather_horse_armor",  name: "Leather Horse Armor",   category: "misc" },
  { id: "bundle",               name: "Bundle",                category: "misc" },
  { id: "recovery_compass",     name: "Recovery Compass",      category: "misc" },
  { id: "disc_fragment_5",      name: "Disc Fragment 5",       category: "misc" },
  { id: "music_disc_13",        name: "Music Disc (13)",       category: "misc" },
  { id: "music_disc_cat",       name: "Music Disc (Cat)",      category: "misc" },
  { id: "music_disc_pigstep",   name: "Music Disc (Pigstep)",  category: "misc" },
  { id: "music_disc_relic",     name: "Music Disc (Relic)",    category: "misc" },
  { id: "firework_rocket",      name: "Firework Rocket",       category: "misc" },
  { id: "firework_star",        name: "Firework Star",         category: "misc" },
  { id: "trial_key",            name: "Trial Key",             category: "misc" },
  { id: "ominous_trial_key",    name: "Ominous Trial Key",     category: "misc" },
];

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "all",        label: "All",         emoji: "⚡" },
  { id: "weapons",    label: "Weapons",     emoji: "⚔️" },
  { id: "tools",      label: "Tools",       emoji: "⛏" },
  { id: "armor",      label: "Armor",       emoji: "🛡" },
  { id: "resources",  label: "Resources",   emoji: "💎" },
  { id: "food",       label: "Food",        emoji: "🍖" },
  { id: "potions",    label: "Potions",     emoji: "🧪" },
  { id: "blocks",     label: "Blocks",      emoji: "🧱" },
  { id: "plants",     label: "Plants",      emoji: "🌿" },
  { id: "spawn_eggs", label: "Spawn Eggs",  emoji: "🥚" },
  { id: "misc",       label: "Misc",        emoji: "🎁" },
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

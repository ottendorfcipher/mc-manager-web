import { useState, useEffect } from "react";

/**
 * Renders a Minecraft item texture.
 *
 * Cascade:
 *  1. assets/minecraft/textures/item/{name}.png   (tools, weapons, food, potions…)
 *  2. assets/minecraft/textures/block/{name}.png  (stone, dirt, planks…)
 *  3. Styled placeholder with a 2-char abbreviation
 *
 * Source: InventivetalentDev/minecraft-assets via jsDelivr CDN.
 */

const BASE =
  "https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures/";

type State = "item" | "block" | "failed";

interface Props {
  /** Full or bare item ID, e.g. "minecraft:diamond_sword" or "diamond_sword" */
  id:        string;
  size?:     number;
  className?: string;
}

export function McItemImage({ id, size = 32, className = "" }: Props) {
  const bare = id.replace("minecraft:", "");
  const [state, setState] = useState<State>("item");

  // Reset cascade whenever the item id changes
  useEffect(() => { setState("item"); }, [bare]);

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
          className="font-bold text-[#9B9EA6] select-none leading-none"
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

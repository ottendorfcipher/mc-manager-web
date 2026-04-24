import { useMemo } from "react";

/**
 * Decorative falling-block backdrop for the login splash.
 *
 * Design:
 *  - Pure CSS keyframes; no RAF loops, no canvas — cheap on mobile battery.
 *  - `aria-hidden` because it carries no information (NN/g H7: minimalist).
 *  - Hidden entirely under `prefers-reduced-motion: reduce` via CSS.
 *  - Uses only existing brand tokens — no new colors.
 *  - Deterministic per `seed` so Playwright runs are stable.
 */
const BLOCK_COLORS = [
  "#5B9BF0", // accent blue
  "#36B37E", // success green (grass)
  "#8B6F4E", // dirt brown
  "#6B6E78", // stone grey
];

// ~3x fewer blocks + shorter fall time → drastically lower paint/composite cost.
const COLUMN_COUNT = 10;
const BLOCKS_PER_COLUMN = 2;

type Block = {
  left: number;        // vw
  size: number;        // px
  delay: number;       // s
  duration: number;    // s
  color: string;
};

/** Mulberry32 PRNG — stable output per seed for deterministic tests. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateBlocks(seed: number): Block[] {
  const rand = prng(seed);
  const blocks: Block[] = [];
  for (let col = 0; col < COLUMN_COUNT; col++) {
    for (let i = 0; i < BLOCKS_PER_COLUMN; i++) {
      blocks.push({
        left: (col / COLUMN_COUNT) * 100 + rand() * (100 / COLUMN_COUNT),
        size: 20 + Math.floor(rand() * 8),
        delay: rand() * 5,
        // 4–7s: noticeably faster motion, shorter on-screen lifetime.
        duration: 4 + rand() * 3,
        color: BLOCK_COLORS[Math.floor(rand() * BLOCK_COLORS.length)],
      });
    }
  }
  return blocks;
}

export function MinecraftBackdrop({ seed = 42 }: { seed?: number }) {
  const blocks = useMemo(() => generateBlocks(seed), [seed]);

  return (
    <div
      className="mc-backdrop"
      aria-hidden="true"
      data-testid="mc-backdrop"
    >
      {blocks.map((b, i) => (
        <span
          key={i}
          className="mc-block pixel"
          data-testid="mc-block"
          style={{
            left: `${b.left}vw`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            background: b.color,
            animationDelay: `-${b.delay}s`,
            animationDuration: `${b.duration}s`,
          }}
        />
      ))}
      {/* Pixelated grass strip at the bottom anchors the scene. */}
      <div className="mc-ground pixel" aria-hidden="true" />
    </div>
  );
}

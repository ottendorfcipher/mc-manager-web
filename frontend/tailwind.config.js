/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Birch light / Obsidian dark — static tokens
        accent:  { DEFAULT: "#5B9BF0", hover: "#4080D8" },
        success: { DEFAULT: "#36B37E", hover: "#2A9A6A" },
        warning: { DEFAULT: "#FBBF24" },
        danger:  { DEFAULT: "#F87171", hover: "#E05050" },
        // CSS-variable-backed semantic tokens — light/dark handled by :root/.dark in index.css
        // text-meta : tertiary/metadata text  (#767980 light | #A8AEBB dark) — passes WCAG AA
        // text-sub  : secondary text          (#6B6E78 light | #A0A8BB dark) — passes WCAG AA
        // text-warn : warning text on any bg  (#B45309 light | #FBBF24 dark)
        meta: "var(--color-meta)",
        sub:  "var(--color-sub)",
        warn: "var(--color-warn)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};


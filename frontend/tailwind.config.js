/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Birch light / Obsidian dark palette
        accent:  { DEFAULT: "#5B9BF0", hover: "#4080D8" },
        success: { DEFAULT: "#36B37E", hover: "#2A9A6A" },
        warning: { DEFAULT: "#FBBF24" },
        danger:  { DEFAULT: "#F87171", hover: "#E05050" },
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};


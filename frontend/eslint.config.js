// ESLint 9 flat config for the redstoneCipher frontend.
// Lints src/ only (TS/TSX). Config files, build output, and e2e specs are
// excluded. Noisy stylistic rules are downgraded to warnings so `eslint .`
// gates on genuine errors (it exits non-zero only on errors, not warnings);
// the react-hooks rules — which catch real bugs — stay as errors.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "e2e/**",
      "**/*.config.{js,ts,cjs,mjs}",
      "vite.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Classic, stable hooks rules. We intentionally do NOT enable the
      // experimental React-Compiler rules added in react-hooks v7 (refs-during-
      // render, setState-in-effect, purity, …) — they flag patterns that work
      // correctly today and would need broad refactors. Revisit when adopting
      // the React Compiler.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // `tsc --noEmit` is the source of truth for unused symbols (gated in CI);
      // keep ESLint's overlapping rules as warnings to avoid duplicate failures.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);

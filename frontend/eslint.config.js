import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Pragmatic tuning for a small app; keep the rest of sonarjs defaults.
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/cognitive-complexity': ['warn', 20],
      // Demoted so pre-existing issues show as signal but don't block CI;
      // new code should tighten these back to 'error'.
      'sonarjs/no-nested-conditional': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Test fixtures legitimately contain hardcoded IPs and paths.
    files: ['e2e/**/*.{ts,tsx}'],
    rules: {
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])

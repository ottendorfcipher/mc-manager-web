import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// Detect whether Vite will use HTTPS (mirrors vite.config.ts logic).
// We use path.resolve() instead of import.meta.url because Playwright's
// esbuild-based config loader can produce unexpected values for import.meta.url,
// causing __dirname to point to the wrong location.
// path.resolve() uses the Node.js process cwd, which Playwright sets to the
// directory containing playwright.config.ts when discovered automatically.
const certPath = path.resolve("certs/localhost.pem");
const BASE_URL = fs.existsSync(certPath) ? "https://localhost:5173" : "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,  // SSE/WS tests need isolation
  retries: 1,
  workers: 1,
  reporter: [["html", { open: "never" }], ["line"]],

  use: {
    baseURL:          BASE_URL,
    ignoreHTTPSErrors: true,   // local mkcert cert is self-signed
    trace:            "on-first-retry",
    screenshot:       "only-on-failure",
    video:            "retain-on-failure",
    extraHTTPHeaders: {},
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command:             "npm run dev",
    url:                 BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout:             120_000,  // Vite pre-bundling can be slow on first run
    ignoreHTTPSErrors:   true,
    stdout:              "pipe",
    stderr:              "pipe",
  },
});

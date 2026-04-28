import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,  // SSE/WS tests need isolation
  retries: 1,
  workers: 1,
  reporter: [["html", { open: "never" }], ["line"]],

  use: {
    baseURL:          "https://localhost:5173",
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
    command: "npm run dev",
    url:     "https://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    ignoreHTTPSErrors: true,
  },
});

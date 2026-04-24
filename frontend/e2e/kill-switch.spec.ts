import { test, expect, type Page } from "@playwright/test";

const GLOBAL_ADMIN_PERMS = [
  "nav.dashboard", "nav.server", "nav.team", "nav.backups", "nav.configure", "nav.admin",
  "killswitch.view", "killswitch.toggle",
];

async function auth(page: Page, permission_keys: string[]) {
  await page.route("/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("/api/me", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        email: "admin@example.com",
        role: "global_admin",
        display_name: "Admin",
        avatar_url: null,
        permissions: { can_manage_users: true, can_control_server: true, can_write_config: true, can_restore_backup: true, can_manage_admins: true },
        permission_keys,
      }),
    }),
  );
}

test.describe("Kill-switch banner", () => {
  test("hidden when kill-switch is released", async ({ page }) => {
    await auth(page, GLOBAL_ADMIN_PERMS);
    await page.route("/api/kill-switch", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disabled_at: null, reason: null, source: null }) }),
    );
    await page.goto("/");
    await expect(page.getByTestId("kill-switch-banner")).toHaveCount(0);
  });

  test("shown when engaged, with reason + source + Re-enable for admins", async ({ page }) => {
    await auth(page, GLOBAL_ADMIN_PERMS);
    await page.route("/api/kill-switch", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          disabled_at: "2026-04-17T05:00:00Z",
          reason: "Budget exceeded: $6.00 of $5.00",
          source: "budget-webhook",
        }),
      }),
    );
    await page.goto("/");
    const banner = page.getByTestId("kill-switch-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Budget exceeded");
    await expect(banner).toContainText("budget-webhook");
    await expect(page.getByTestId("kill-switch-release")).toBeVisible();
  });

  test("Re-enable clicks DELETE and hides the banner", async ({ page }) => {
    await auth(page, GLOBAL_ADMIN_PERMS);

    // First poll returns engaged, subsequent polls + the DELETE response return released.
    let deleted = false;
    await page.route("/api/kill-switch", (route) => {
      const method = route.request().method();
      if (method === "DELETE") {
        deleted = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ disabled_at: null, reason: null, source: null }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: deleted
          ? JSON.stringify({ disabled_at: null, reason: null, source: null })
          : JSON.stringify({ disabled_at: "2026-04-17T05:00:00Z", reason: "Budget exceeded", source: "budget-webhook" }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("kill-switch-banner")).toBeVisible();
    await page.getByTestId("kill-switch-release").click();
    await expect(page.getByTestId("kill-switch-banner")).toHaveCount(0);
    expect(deleted).toBe(true);
  });

  test("non-admins see the banner but no Re-enable button", async ({ page }) => {
    await auth(page, ["nav.dashboard", "killswitch.view"]); // view only, no toggle
    await page.route("/api/kill-switch", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          disabled_at: "2026-04-17T05:00:00Z",
          reason: "Budget exceeded",
          source: "budget-webhook",
        }),
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId("kill-switch-banner")).toBeVisible();
    await expect(page.getByTestId("kill-switch-release")).toHaveCount(0);
  });
});

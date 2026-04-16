import { test, expect } from "@playwright/test";

/**
 * Auth flow tests.
 * These tests mock /api/me to avoid real Google OAuth in CI.
 */

test.describe("Authentication", () => {
  test("unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.route("/api/me", (r) => r.fulfill({ status: 401, body: JSON.stringify({ error: "Not authenticated" }) }));
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("MC Server Manager")).toBeVisible();
    await expect(page.getByText("Continue with Google")).toBeVisible();
  });

  test("login page has correct CTA and accessible landmark", async ({ page }) => {
    await page.route("/api/me", (r) => r.fulfill({ status: 401, body: "{}" }));
    await page.goto("/login");
    const btn = page.getByRole("link", { name: /Continue with Google/i });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("href", "/auth/login");
  });

  test("authenticated user sees Dashboard", async ({ page }) => {
    await page.route("/api/me", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          email: "nicholasaweiner@gmail.com",
          role: "global_admin",
          display_name: "Nicholas",
          avatar_url: null,
          permissions: {
            can_manage_users: true, can_control_server: true,
            can_write_config: true, can_restore_backup: true, can_manage_admins: true,
          },
        }),
      })
    );
    await page.route("/api/server/status", (r) =>
      r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ vm: { status: "RUNNING", external_ip: "1.2.3.4", tailscale_ip: "100.80.114.91" }, service: "active" }) })
    );
    await page.route("/api/metrics", (r) => r.fulfill({ status: 200 }));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Nicholas")).toBeVisible();
  });

  test("sidebar shows all nav items for global admin", async ({ page }) => {
    await page.route("/api/me", (r) =>
      r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ email: "nicholasaweiner@gmail.com", role: "global_admin", display_name: "Nicholas", avatar_url: null,
          permissions: { can_manage_users: true, can_control_server: true, can_write_config: true, can_restore_backup: true, can_manage_admins: true } }) })
    );
    await page.route("/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/");
    for (const label of ["Dashboard", "Server", "Team", "Backups", "Configure"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

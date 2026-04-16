import { test, expect } from "@playwright/test";

const ME = {
  email: "admin@example.com", role: "global_admin", display_name: "Nicholas", avatar_url: null,
  permissions: { can_manage_users: true, can_control_server: true, can_write_config: true, can_restore_backup: true, can_manage_admins: true },
};

const STATUS = {
  vm: { status: "RUNNING", external_ip: "34.1.2.3", tailscale_ip: "100.64.0.3" },
  service: "active",
};

test.describe("Server Control page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/me",            (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) }));
    await page.route("/api/server/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STATUS) }));
    await page.route("/api/metrics",       (r) => r.fulfill({ status: 200 }));
  });

  test("shows VM status and action buttons", async ({ page }) => {
    await page.goto("/server");
    await expect(page.getByText("Cloud VM (GCP Spot)")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start VM/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Stop VM/i })).toBeVisible();
  });

  test("shows time preset buttons", async ({ page }) => {
    await page.goto("/server");
    for (const label of ["Sunrise", "Day", "Sunset", "Night"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
  });

  test("shows weather preset buttons", async ({ page }) => {
    await page.goto("/server");
    for (const label of ["Clear", "Rain", "Thunder"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
  });

  test("shows all gamerule toggles", async ({ page }) => {
    await page.goto("/server");
    await expect(page.getByText("Show Coordinates")).toBeVisible();
    await expect(page.getByText("Keep Inventory")).toBeVisible();
    await expect(page.getByText("Fire Spreads")).toBeVisible();
    await expect(page.getByText("Mob Griefing")).toBeVisible();
  });

  test("Start VM button calls API", async ({ page }) => {
    let called = false;
    await page.route("/api/server/vm/start", (r) => { called = true; r.fulfill({ status: 202 }); });
    await page.goto("/server");
    await page.getByRole("button", { name: /Start VM/i }).click();
    await page.waitForTimeout(300);
    expect(called).toBe(true);
  });
});

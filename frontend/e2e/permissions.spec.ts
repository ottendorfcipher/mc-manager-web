import { test, expect, type Page } from "@playwright/test";

/** Build a /api/me response body for the given role + permission keys. */
function meBody(role: string, permission_keys: string[]) {
  return JSON.stringify({
    email: "tester@example.com",
    role,
    display_name: "Tester",
    avatar_url: null,
    permissions: {
      can_manage_users:   permission_keys.includes("users.invite"),
      can_control_server: permission_keys.includes("server.vm.start"),
      can_write_config:   permission_keys.includes("config.write"),
      can_restore_backup: permission_keys.includes("backups.restore"),
      can_manage_admins:  permission_keys.includes("users.permissions.edit"),
    },
    permission_keys,
  });
}

async function stub(page: Page, role: string, permission_keys: string[]) {
  await page.route("/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("/api/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: meBody(role, permission_keys) }),
  );
  await page.route("/api/kill-switch", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disabled_at: null, reason: null, source: null }) }),
  );
}

test.describe("Navigation permission filtering", () => {
  test("global_admin sees every nav item including Admin", async ({ page }) => {
    await stub(page, "global_admin", [
      "nav.dashboard", "nav.server", "nav.team", "nav.backups", "nav.configure", "nav.admin",
      "killswitch.view",
    ]);
    await page.goto("/");
    for (const label of ["Dashboard", "Server", "Team", "Backups", "Configure", "Admin"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("member sees only everyday nav, not Admin", async ({ page }) => {
    await stub(page, "member", [
      "nav.dashboard", "nav.server", "nav.team", "nav.backups", "nav.configure",
      "killswitch.view",
    ]);
    await page.goto("/");
    for (const label of ["Dashboard", "Server", "Team", "Backups", "Configure"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("visitor sees only Dashboard", async ({ page }) => {
    await stub(page, "visitor", ["nav.dashboard", "killswitch.view"]);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    for (const hidden of ["Server", "Team", "Backups", "Configure", "Admin"]) {
      await expect(page.getByRole("link", { name: hidden })).toHaveCount(0);
    }
  });
});

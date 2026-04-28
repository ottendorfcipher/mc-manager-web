import { test, expect } from "@playwright/test";

const ADMIN_ME = {
  email: "admin@example.com", role: "global_admin", display_name: "Nicholas",
  avatar_url: null,
  permissions: { can_manage_users: true, can_control_server: true, can_write_config: true, can_restore_backup: true, can_manage_admins: true },
};

const MEMBER_ME = {
  email: "member@example.com", role: "member", display_name: "Member",
  avatar_url: null,
  permissions: { can_manage_users: false, can_control_server: true, can_write_config: false, can_restore_backup: false, can_manage_admins: false },
};

const USERS = [ADMIN_ME, { ...MEMBER_ME, role: "member" }];

function mockAdmin(page: any) {
  page.route("/api/me",    (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ME) }));
  page.route("/api/users", (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USERS) }));
  page.route("/api/users/*/players",  (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  page.route("/api/mc/players",       (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

test.describe("Team page — roster view", () => {
  test("shows all team members for admin", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    // Use unique email text to avoid collisions with role badge text
    await expect(page.getByText("admin@example.com")).toBeVisible();
    await expect(page.getByText("member@example.com")).toBeVisible();
  });

  test("shows search input", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await expect(page.getByPlaceholder(/Search by name/i)).toBeVisible();
  });

  test("no Add Member or Remove buttons on team page (moved to Admin)", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await expect(page.getByRole("button", { name: /Add Member/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });
});

test.describe("Team page — member", () => {
  test("member sees roster without admin controls", async ({ page }) => {
    page.route("/api/me",         (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MEMBER_ME) }));
    page.route("/api/users",      (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USERS) }));
    page.route("/api/mc/players", (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    page.route("/api/users/*/players", (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Member/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });
});

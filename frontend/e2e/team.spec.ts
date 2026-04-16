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

test.describe("Team page — admin", () => {
  test("shows Add Member button for admin", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await expect(page.getByRole("button", { name: /Add Member/i })).toBeVisible();
  });

  test("user cards list all members", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await expect(page.getByText("Nicholas")).toBeVisible();
    await expect(page.getByText("Member")).toBeVisible();
  });

  test("invite modal opens and has email + role fields", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Add Member/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByPlaceholder("user@gmail.com")).toBeVisible();
    await expect(page.getByRole("combobox")).toBeVisible();
  });

  test("invite modal closes on Cancel", async ({ page }) => {
    mockAdmin(page);
    await page.goto("/team");
    await page.getByRole("button", { name: /Add Member/i }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

test.describe("Team page — member", () => {
  test("member does not see Add Member button", async ({ page }) => {
    page.route("/api/me",    (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MEMBER_ME) }));
    page.route("/api/users", (r: any) => r.fulfill({ status: 403, body: "{}" }));
    await page.goto("/team");
    await expect(page.getByRole("button", { name: /Add Member/i })).not.toBeVisible();
  });
});

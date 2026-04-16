import { test, expect } from "@playwright/test";

const ME = {
  email: "nicholasaweiner@gmail.com", role: "global_admin", display_name: "Nicholas", avatar_url: null,
  permissions: { can_manage_users: true, can_control_server: true, can_write_config: true, can_restore_backup: true, can_manage_admins: true },
};

const BACKUPS = [
  { id: 1, filename: "mc-world-20260415-010203.tar.gz", file_path: "/tmp/b1.tar.gz",
    size_bytes: 7_200_000, created_by: "nicholasaweiner@gmail.com", created_at: "2026-04-15T01:02:03Z", notes: null },
];

test.describe("Backups page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/me",      (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) }));
    await page.route("/api/backups", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BACKUPS) }));
  });

  test("lists existing backups", async ({ page }) => {
    await page.goto("/backups");
    await expect(page.getByText("mc-world-20260415-010203.tar.gz")).toBeVisible();
    await expect(page.getByText(/6\.9 MB/)).toBeVisible();
  });

  test("Create Backup button is visible for admin", async ({ page }) => {
    await page.goto("/backups");
    await expect(page.getByRole("button", { name: /Create Backup/i })).toBeVisible();
  });

  test("restore confirm dialog appears on Restore click", async ({ page }) => {
    await page.goto("/backups");
    await page.getByTitle("Restore").first().click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  });

  test("restore confirm dialog cancels correctly", async ({ page }) => {
    await page.goto("/backups");
    await page.getByTitle("Restore").first().click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
  });

  test("empty state shown when no backups", async ({ page }) => {
    await page.route("/api/backups", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/backups");
    await expect(page.getByText("No backups yet")).toBeVisible();
  });
});

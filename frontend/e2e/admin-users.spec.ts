import { test, expect, type Page } from "@playwright/test";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_ME = {
  email: "nicholasaweiner@gmail.com",
  role: "global_admin",
  display_name: "Nicholas",
  avatar_url: null,
  permissions: {
    can_manage_users: true, can_control_server: true,
    can_write_config: true, can_restore_backup: true, can_manage_admins: true,
  },
  permission_keys: [
    "users.invite", "users.remove", "users.role.change", "users.permissions.edit",
    "nav.admin", "nav.dashboard", "nav.team", "killswitch.view", "killswitch.toggle",
  ],
};

const ALICE: User = {
  email: "alice@example.com", role: "member", display_name: "Alice",
  avatar_url: null, google_sub: "sub_alice",
  added_by: "nicholasaweiner@gmail.com", added_at: "2026-01-02T00:00:00Z", last_login: "2026-04-01T00:00:00Z",
};

const BOB: User = {
  email: "bob@example.com", role: "visitor", display_name: "Bob",
  avatar_url: null, google_sub: null, // pending sign-in
  added_by: "nicholasaweiner@gmail.com", added_at: "2026-01-03T00:00:00Z", last_login: null,
};

interface User {
  email: string; role: string; display_name: string; avatar_url: null | string;
  google_sub: string | null; added_by: string; added_at: string; last_login: string | null;
}

async function mockAdmin(page: Page, users: User[] = [ALICE, BOB]) {
  await page.route("/api/kill-switch", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ disabled_at: null, reason: null, source: null }) }),
  );
  await page.route("/api/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ME) }),
  );
  await page.route("/api/users", (r) => {
    if (r.request().method() === "GET") {
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) });
    }
    return r.continue();
  });
  await page.route("/api/users/*/players", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("/api/mc/players", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Admin → Users tab", () => {
  test("loads at /admin and shows Users tab by default", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin");
    await expect(page.getByTestId("tab-users")).toBeVisible();
    await expect(page.getByTestId("tab-pairing")).toBeVisible();
    await expect(page.getByTestId("tab-permissions")).toBeVisible();
  });

  test("lists all users with names and emails", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin");
    // Use email text which is unique and unambiguous (no substring collisions)
    await expect(page.getByText("alice@example.com")).toBeVisible();
    await expect(page.getByText("bob@example.com")).toBeVisible();
  });

  test("shows Pending sign-in badge for users without google_sub", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin");
    await expect(page.getByText("Pending sign-in")).toBeVisible();
  });

  test("Invite User button opens invite dialog", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin");
    await page.getByTestId("invite-user-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("user@gmail.com")).toBeVisible();
    // Scope combobox lookup to the dialog to avoid matching per-user role selectors
    await expect(dialog.getByRole("combobox")).toBeVisible();
  });

  test("invite dialog closes on Cancel", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin");
    await page.getByTestId("invite-user-btn").click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("Send Invite POSTs to /api/users and closes dialog", async ({ page }) => {
    await mockAdmin(page);
    let inviteBody: unknown = null;
    await page.route("/api/users", (r) => {
      if (r.request().method() === "POST") {
        inviteBody = JSON.parse(r.request().postData() ?? "{}");
        return r.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({
            email: "new@example.com", role: "member", display_name: "New",
            google_sub: null, avatar_url: null,
            added_by: "nicholasaweiner@gmail.com", added_at: "2026-04-24T00:00:00Z", last_login: null,
          }),
        });
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([ALICE, BOB]) });
    });

    await page.goto("/admin");
    await page.getByTestId("invite-user-btn").click();
    await page.getByPlaceholder("user@gmail.com").fill("new@example.com");
    await page.getByRole("button", { name: "Send Invite" }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect((inviteBody as { email: string }).email).toBe("new@example.com");
  });

  test("Remove button DELETEs user and is absent for self / global admin", async ({ page }) => {
    await mockAdmin(page);
    let deletedEmail = "";
    await page.route("/api/users/alice%40example.com", (r) => {
      if (r.request().method() === "DELETE") {
        deletedEmail = "alice@example.com";
        return r.fulfill({ status: 204 });
      }
      return r.continue();
    });

    await page.goto("/admin");
    // Find Alice's card specifically
    const aliceCard = page.locator("[data-testid='user-card']").filter({ hasText: "alice@example.com" });
    await aliceCard.getByRole("button", { name: "Remove" }).click();
    expect(deletedEmail).toBe("alice@example.com");

    // No remove button for self (Nicholas)
    const selfCard = page.locator("[data-testid='user-card']").filter({ hasText: "nicholasaweiner@gmail.com" });
    await expect(selfCard.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("/admin/permissions redirects to /admin (compat route)", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin/permissions");
    // Should render the AdminPage (same component)
    await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();
  });
});

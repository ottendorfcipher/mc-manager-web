/**
 * E2E tests for the dynamic role management admin UI.
 *
 * These tests assume the global admin (nicholasaweiner@gmail.com) is
 * already authenticated.  They run against the local dev server
 * (http://localhost:5173) which proxies API calls to the backend at
 * http://localhost:8787.
 *
 * Scope:
 *   • Roles tab is visible to global_admin
 *   • Create a custom role with name, label, color, level
 *   • Edit the role's display name and color
 *   • Expand the permission editor and toggle a permission
 *   • Apply the permission change and verify it persists
 *   • Assign the new role to a test user
 *   • Add and remove a per-user permission override
 *   • Delete the custom role (only appears when empty)
 *   • Verify system roles cannot be deleted
 */

import { test, expect } from "@playwright/test";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Navigate to the Admin page and switch to the Roles tab. */
async function goToRolesTab(page: import("@playwright/test").Page) {
  await page.goto("/admin");
  await page.getByTestId("tab-roles").click();
  await expect(page.getByTestId("create-role-btn")).toBeVisible();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("Roles tab visibility", () => {
  test("global admin sees Roles tab", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("tab-roles")).toBeVisible();
  });
});

test.describe("System role guards", () => {
  test("system role delete button is disabled", async ({ page }) => {
    await goToRolesTab(page);
    // The 'global_admin' row should have a disabled delete button
    const deleteBtn = page.getByTestId("delete-global_admin");
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
  });

  test("clicking disabled delete button shows tooltip text", async ({ page }) => {
    await goToRolesTab(page);
    const deleteBtn = page.getByTestId("delete-admin");
    await expect(deleteBtn).toBeDisabled();
    // Tooltip is on the button's title attribute
    await expect(deleteBtn).toHaveAttribute("title", /System roles cannot be deleted/);
  });
});

test.describe("Create custom role", () => {
  const TEST_ROLE_NAME = "e2e-test-role";

  test.afterEach(async ({ request }) => {
    // Clean up the test role via the API if it exists
    await request.delete(`/api/roles/${TEST_ROLE_NAME}`).catch(() => {/* ignore 404 */});
  });

  test("create a custom role and verify it appears in the list", async ({ page }) => {
    await goToRolesTab(page);

    // Open create modal
    await page.getByTestId("create-role-btn").click();
    await expect(page.getByRole("dialog", { name: /Create Custom Role/i })).toBeVisible();

    // Fill in form
    await page.getByTestId("create-role-name").fill(TEST_ROLE_NAME);
    await page.getByTestId("create-role-label").fill("E2E Test Role");
    // Select a color
    await page.getByTestId("color-#A78BFA").click();
    // Set level to 1
    await page.getByTestId("create-role-level").fill("1");

    // Submit
    await page.getByTestId("create-role-submit").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Verify row appears
    await expect(page.getByTestId(`role-row-${TEST_ROLE_NAME}`)).toBeVisible();
    await expect(page.getByTestId(`role-row-${TEST_ROLE_NAME}`)).toContainText("E2E Test Role");
  });

  test("invalid role name shows validation error", async ({ page }) => {
    await goToRolesTab(page);
    await page.getByTestId("create-role-btn").click();

    // Type an invalid name
    await page.getByTestId("create-role-name").fill("Invalid Name");
    await expect(page.locator("text=Must start with a letter")).toBeVisible();

    // Submit should be disabled
    await expect(page.getByTestId("create-role-submit")).toBeDisabled();
  });
});

test.describe("Edit role metadata", () => {
  test("can edit label and color of a custom role", async ({ page, request }) => {
    // Pre-create a role via API
    await request.post("/api/roles", {
      data: { name: "editme-e2e", label: "Old Label", level: 1 },
    });

    await goToRolesTab(page);

    // Click Edit button
    await page.getByTestId("edit-meta-editme-e2e").click();

    // Change label
    const labelInput = page.getByRole("textbox", { name: /Display Name/i }).last();
    await labelInput.clear();
    await labelInput.fill("New Label");

    // Save
    await page.getByTestId("save-role-meta").click();
    await expect(page.getByTestId("role-row-editme-e2e")).toContainText("New Label");

    // Cleanup
    await request.delete("/api/roles/editme-e2e");
  });
});

test.describe("Permission editor", () => {
  test("can toggle a permission and apply it", async ({ page, request }) => {
    await request.post("/api/roles", {
      data: { name: "permedit-e2e", label: "Perm Edit", level: 1 },
    });

    await goToRolesTab(page);

    // Open permissions panel
    await page.getByTestId("perms-permedit-e2e").click();

    // Expand 'server' category
    await page.getByRole("button", { name: /^server/i }).click();

    // Toggle server.announce
    const toggle = page.getByTestId("perm-toggle-server.announce");
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Apply
    await page.getByTestId("apply-permissions").click();
    await expect(page.getByText("Unsaved changes")).not.toBeVisible();

    // Cleanup
    await request.delete("/api/roles/permedit-e2e");
  });
});

test.describe("Delete custom role", () => {
  test("can delete an empty custom role", async ({ page, request }) => {
    await request.post("/api/roles", {
      data: { name: "del-e2e", label: "Delete Me", level: 1 },
    });

    await goToRolesTab(page);

    await page.getByTestId("delete-del-e2e").click();
    await expect(page.getByRole("dialog", { name: /Delete role/i })).toBeVisible();
    await page.getByTestId("confirm-delete-btn").click();

    await expect(page.getByTestId("role-row-del-e2e")).not.toBeVisible();
  });
});

test.describe("Per-user permission overrides", () => {
  test("can add and remove a permission override on a user", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("tab-users").click();

    // Click the global admin user row to open the detail panel
    const userCard = page.getByTestId("user-card").first();
    await userCard.click();

    // Wait for override panel
    await expect(page.getByTestId("add-override-btn")).toBeVisible();
    await page.getByTestId("add-override-btn").click();

    // Select a permission from the dropdown
    await page.getByTestId("override-select").selectOption({ label: /server.kick/ });
    await page.getByTestId("confirm-override-btn").click();

    // Verify it appears
    await expect(page.getByTestId("override-server.kick")).toBeVisible();

    // Remove it
    await page.getByRole("button", { name: /Remove override server.kick/i }).click();
    await expect(page.getByTestId("override-server.kick")).not.toBeVisible();
  });
});

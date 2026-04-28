import { test, expect, type Page } from "@playwright/test";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_ME = {
  email: "admin@example.com",
  role: "global_admin",
  display_name: "Nicholas",
  avatar_url: null,
  permissions: {
    can_manage_users: true, can_control_server: true,
    can_write_config: true, can_restore_backup: true, can_manage_admins: true,
  },
  permission_keys: [
    "users.invite", "users.remove", "nav.admin", "nav.dashboard", "killswitch.view",
  ],
};

const ALICE = {
  email: "alice@example.com", role: "member", display_name: "Alice",
  avatar_url: null, google_sub: "sub_alice",
  added_by: "admin", added_at: "2026-01-01T00:00:00Z", last_login: "2026-04-01T00:00:00Z",
};

const PENDING_USER = {
  email: "pending@example.com", role: "visitor", display_name: "Pending",
  avatar_url: null, google_sub: null,  // has not signed in yet
  added_by: "admin", added_at: "2026-01-05T00:00:00Z", last_login: null,
};

const MC_PLAYERS = [
  { ign: "AliceIGN",  uuid: "uuid-1", online: true  },
  { ign: "SteveMC",   uuid: "uuid-2", online: false },
];

const ALICE_LINKS = [
  { id: 1, email: "alice@example.com", ign: "AliceIGN", gamemode: "survival", linked_at: "2026-01-10T00:00:00Z" },
];

async function mockSetup(
  page: Page,
  aliceLinks = ALICE_LINKS,
) {
  await page.route("/api/kill-switch", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ disabled_at: null, reason: null, source: null }) }),
  );
  await page.route("/api/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ME) }),
  );
  await page.route("/api/users", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify([ALICE, PENDING_USER]) }),
  );
  await page.route("/api/users/alice%40example.com/players", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aliceLinks) }),
  );
  await page.route("/api/mc/players", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MC_PLAYERS) }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Admin → Minecraft Pairing tab", () => {
  test("shows only activated users (excludes pending sign-in)", async ({ page }) => {
    await mockSetup(page);
    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();

    // Alice (activated) is shown — scope to pairing-card to avoid email/IGN substring collisions
    const aliceCard = page.locator("[data-testid='pairing-card']").filter({ hasText: "alice@example.com" });
    await expect(aliceCard).toBeVisible();

    // Pending user is excluded — no pairing card should mention the pending email
    await expect(page.locator("[data-testid='pairing-card']").filter({ hasText: "pending@example.com" })).toHaveCount(0);
  });

  test("shows existing player links with online indicator", async ({ page }) => {
    await mockSetup(page);
    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();

    await expect(page.getByText("AliceIGN")).toBeVisible();
  });

  test("unlink button sends DELETE /api/users/:email/players/:ign", async ({ page }) => {
    let unlinked = false;
    await mockSetup(page);
    await page.route("/api/users/alice%40example.com/players/AliceIGN", (r) => {
      if (r.request().method() === "DELETE") {
        unlinked = true;
        return r.fulfill({ status: 204 });
      }
      return r.continue();
    });

    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();
    await page.getByRole("button", { name: "Unlink AliceIGN" }).click();
    expect(unlinked).toBe(true);
  });

  test("IGN input shows datalist suggestions from MC players", async ({ page }) => {
    await mockSetup(page, []); // Alice has no links yet
    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();

    const pairingCard = page.locator("[data-testid='pairing-card']").filter({ hasText: "Alice" });
    const input = pairingCard.getByPlaceholder("IGN (e.g. Steve)");
    await expect(input).toBeVisible();
  });

  test("link button sends PUT /api/users/:email/players with new IGN", async ({ page }) => {
    await mockSetup(page, []); // no existing links
    let putBody: { igns: string[] } | null = null;

    await page.route("/api/users/alice%40example.com/players", (r) => {
      if (r.request().method() === "PUT") {
        putBody = JSON.parse(r.request().postData() ?? "{}");
        return r.fulfill({ status: 204 });
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();

    const pairingCard = page.locator("[data-testid='pairing-card']").filter({ hasText: "Alice" });
    await pairingCard.getByPlaceholder("IGN (e.g. Steve)").fill("SteveMC");
    await pairingCard.getByTestId("link-ign-btn").click();

    expect(putBody).not.toBeNull();
    expect(putBody?.igns).toContain("SteveMC");
  });

  test("Enter key in IGN input also submits the link", async ({ page }) => {
    await mockSetup(page, []);
    let put = false;
    await page.route("/api/users/alice%40example.com/players", (r) => {
      if (r.request().method() === "PUT") {
        put = true;
        return r.fulfill({ status: 204 });
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/admin");
    await page.getByTestId("tab-pairing").click();

    const pairingCard = page.locator("[data-testid='pairing-card']").filter({ hasText: "Alice" });
    await pairingCard.getByPlaceholder("IGN (e.g. Steve)").fill("SteveMC");
    await pairingCard.getByPlaceholder("IGN (e.g. Steve)").press("Enter");
    expect(put).toBe(true);
  });
});

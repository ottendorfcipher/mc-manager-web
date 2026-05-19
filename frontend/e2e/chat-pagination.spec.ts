import { test, expect } from "@playwright/test";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ME = {
  email: "nicholasaweiner@gmail.com",
  role: "global_admin",
  display_name: "Nicholas",
  avatar_url: null,
  permissions: {
    can_manage_users: true, can_control_server: true,
    can_write_config: true, can_restore_backup: true, can_manage_admins: true,
  },
  // chat.read + chat.send + nav keys
  permission_keys: [
    "chat.read", "chat.send",
    "nav.chat", "nav.dashboard", "killswitch.view",
  ],
};

/** Build `count` chat messages with ids ending at `maxId` (oldest first). */
function makeMsgs(count: number, maxId: number) {
  return Array.from({ length: count }, (_, i) => {
    const id = maxId - (count - 1 - i);
    return {
      id,
      source:     "web",
      author:     "nicholasaweiner@gmail.com",
      display_as: "Nicholas",
      content:    `Msg#${id}`,
      sent_at:    new Date(Date.UTC(2026, 3, 14, 12, 0, id)).toISOString(),
    };
  });
}

/**
 * Register the standard background routes needed by ChatPage.
 * Patterns use the "**" glob prefix so they match the full request URL
 * (e.g. http://localhost:5173/api/me) regardless of how Playwright resolves
 * the baseURL at route-registration time.
 */
async function setupRoutes(page: import("@playwright/test").Page) {
  // Abort SSE — no real server in test env; the page handles the error gracefully.
  await page.route("**/api/chat/stream", (r) => r.abort());
  await page.route("**/api/mc/players",  (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/kill-switch", (r) =>
    r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ disabled_at: null, reason: null, source: null }),
    }),
  );
  await page.route("**/api/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Chat — pagination", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-seed localStorage before the app boots so the COPPA age gate and
    // onboarding wizard don't block rendering of the authenticated app.
    await page.addInitScript(() => {
      localStorage.setItem("rsc_age_confirmed", "1");
      localStorage.setItem("rsc_onboarding_done", "1");
    });
    await setupRoutes(page);
  });

  // ── 1. No button when history has fewer than 50 messages ───────────────────

  test("hides 'load earlier' button when initial fetch returns fewer than 50 messages", async ({ page }) => {
    const msgs = makeMsgs(20, 20);
    await page.route("**/api/chat/history*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(msgs) }),
    );

    await page.goto("/chat");

    // All 20 messages visible (use exact to avoid substring matches like Msg#10, Msg#11…)
    await expect(page.getByText("Msg#1",  { exact: true })).toBeVisible();
    await expect(page.getByText("Msg#20", { exact: true })).toBeVisible();

    // No "load earlier" button — already showing everything
    await expect(
      page.getByRole("button", { name: /load earlier/i }),
    ).not.toBeVisible();
  });

  // ── 2. Button appears when initial fetch returns exactly 50 messages ───────

  test("shows 'load earlier' button when initial fetch returns exactly 50 messages", async ({ page }) => {
    const msgs = makeMsgs(50, 200); // ids 151–200
    await page.route("**/api/chat/history*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(msgs) }),
    );

    await page.goto("/chat");

    await expect(
      page.getByRole("button", { name: /load earlier/i }),
    ).toBeVisible();
  });

  // ── 3. Button passes correct `before` cursor to the API ───────────────────

  test("passes oldest visible message id as 'before' cursor when loading more", async ({ page }) => {
    // Initial page: ids 151–200 (oldest = 151)
    const initialMsgs = makeMsgs(50, 200);
    // Older page: ids 141–150 (< 100, so no more after this)
    const olderMsgs   = makeMsgs(10, 150);

    let capturedUrl = "";

    await page.route("**/api/chat/history*", (r) => {
      const url = r.request().url();
      if (url.includes("before=")) {
        capturedUrl = url;
        return r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(olderMsgs),
        });
      }
      return r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(initialMsgs),
      });
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /load earlier/i }).click();

    // The before cursor must be the smallest id in the initial page (151)
    expect(capturedUrl).toMatch(/before=151/);
  });

  // ── 4. Older messages are prepended above the initial history ─────────────

  test("prepends older messages above current history after load-more", async ({ page }) => {
    const initialMsgs = makeMsgs(50, 200); // Msg#151 … Msg#200
    const olderMsgs   = makeMsgs(5, 150);  // Msg#146 … Msg#150

    await page.route("**/api/chat/history*", (r) => {
      const url = r.request().url();
      if (url.includes("before=")) {
        return r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(olderMsgs),
        });
      }
      return r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(initialMsgs),
      });
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /load earlier/i }).click();

    // Both ranges now visible
    await expect(page.getByText("Msg#146")).toBeVisible();
    await expect(page.getByText("Msg#151")).toBeVisible();

    // Msg#146 must appear above Msg#151 in the rendered DOM
    const y146 = (await page.getByText("Msg#146").boundingBox())!.y;
    const y151 = (await page.getByText("Msg#151").boundingBox())!.y;
    expect(y146).toBeLessThan(y151);
  });

  // ── 5. Button disappears when load-more returns a partial page ────────────

  test("hides 'load earlier' button after load-more returns fewer than 100 messages", async ({ page }) => {
    const initialMsgs = makeMsgs(50, 200);
    const olderMsgs   = makeMsgs(30, 150); // partial page → no more

    await page.route("**/api/chat/history*", (r) => {
      const url = r.request().url();
      if (url.includes("before=")) {
        return r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(olderMsgs),
        });
      }
      return r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(initialMsgs),
      });
    });

    await page.goto("/chat");
    await expect(page.getByRole("button", { name: /load earlier/i })).toBeVisible();

    await page.getByRole("button", { name: /load earlier/i }).click();

    // Button should now be gone — we received fewer than 100 messages
    await expect(
      page.getByRole("button", { name: /load earlier/i }),
    ).not.toBeVisible();
  });

  // ── 6. Button remains after a full load-more page (100 messages) ──────────

  test("keeps 'load earlier' button when load-more returns exactly 100 messages", async ({ page }) => {
    const initialMsgs = makeMsgs(50, 300);
    const olderMsgs   = makeMsgs(100, 250); // full page → more may exist

    await page.route("**/api/chat/history*", (r) => {
      const url = r.request().url();
      if (url.includes("before=")) {
        return r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(olderMsgs),
        });
      }
      return r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(initialMsgs),
      });
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /load earlier/i }).click();

    // Full page returned — button stays
    await expect(
      page.getByRole("button", { name: /load earlier/i }),
    ).toBeVisible();
  });

  // ── 7. Empty state when no messages at all ────────────────────────────────

  test("shows empty state and no button when there are no messages", async ({ page }) => {
    await page.route("**/api/chat/history*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    await page.goto("/chat");

    await expect(page.getByText(/No messages yet/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /load earlier/i }),
    ).not.toBeVisible();
  });

  // ── 8. Deduplication — duplicate ids across pages are not rendered twice ──

  test("deduplicates messages that appear in both initial and older page responses", async ({ page }) => {
    const initialMsgs = makeMsgs(50, 200); // ids 151–200
    // Older page accidentally overlaps: ids 148–152 (ids 151–152 are in initial)
    const overlappingMsgs = makeMsgs(5, 152); // ids 148–152

    await page.route("**/api/chat/history*", (r) => {
      const url = r.request().url();
      if (url.includes("before=")) {
        return r.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(overlappingMsgs),
        });
      }
      return r.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(initialMsgs),
      });
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /load earlier/i }).click();

    // Msg#151 should appear exactly once even though it was in both pages
    await expect(page.getByText("Msg#151")).toHaveCount(1);
  });
});

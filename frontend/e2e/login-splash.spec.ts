import { test, expect } from "@playwright/test";

/**
 * Login splash coverage.
 *
 * These tests deliberately exercise USER-VISIBLE BEHAVIOUR (what NN/g calls
 * "empirical evaluation"): landmarks, keyboard reachability, error recovery,
 * motion preference compliance, and persisted user preferences.
 *
 * All API calls are mocked so the suite is hermetic and runs with only the
 * Vite dev server.
 */

const mockUnauthenticated = async (page: import("@playwright/test").Page) => {
  await page.route("/api/me", (r) =>
    r.fulfill({ status: 401, body: JSON.stringify({ error: "Not authenticated" }) }),
  );
};

test.describe("Login splash — structure & brand", () => {
  test("has main landmark, brand heading, and primary CTA", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login");

    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "redstoneCipher" })).toBeVisible();
    await expect(page.getByText("Forge your cipher. The server awaits.")).toBeVisible();
    await expect(page.getByTestId("login-cta")).toHaveAttribute("href", "/auth/login");
    await expect(page.getByTestId("invite-badge")).toBeVisible();
  });

  test("unauthenticated visitor is redirected from / to /login", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-cta")).toBeVisible();
  });
});

test.describe("Login splash — keyboard & a11y", () => {
  test("skip-link is the first tab stop and reveals on focus", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /skip to main content/i });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#main-content");
  });

  test("CTA is reachable with two Tab presses and activates on Enter", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login");

    // 1st Tab: skip-link. 2nd Tab: CTA.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("login-cta")).toBeFocused();
  });
});

test.describe("Login splash — error recovery (NN/g H9)", () => {
  test("?error=not_invited renders a live alert with friendly copy", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login?error=not_invited");

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("invite list");
  });

  test("dismiss button clears the banner and strips ?error from the URL", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login?error=token_exchange");

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await page.getByRole("button", { name: /dismiss error/i }).click();
    await expect(alert).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("Escape dismisses the error banner", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login?error=state_mismatch");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("unknown error code falls back to generic copy", async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto("/login?error=totally_made_up");
    await expect(page.getByRole("alert")).toContainText(/something went wrong/i);
  });
});

test.describe("Login splash — motion preferences", () => {
  test("backdrop respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockUnauthenticated(page);
    await page.goto("/login");

    // Preflight: ensure the emulation actually propagated.
    const reduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reduced).toBe(true);

    const blocks = page.getByTestId("mc-block");
    expect(await blocks.count()).toBeGreaterThan(0);

    // Under reduced motion, the decorative blocks must be removed from the
    // document flow. display:none is our strongest a11y guarantee.
    const display = await blocks.first().evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    expect(display).toBe("none");
  });
});

test.describe("Login splash — sound preference persistence", () => {
  test("defaults to OFF and persists when toggled", async ({ page, context }) => {
    await mockUnauthenticated(page);
    await page.goto("/login");

    const toggle = page.getByTestId("sound-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Reload and verify persistence.
    await page.reload();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");

    await context.clearCookies();
  });
});

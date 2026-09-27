import { test, expect } from "@playwright/test";

// Runs against the "dummy-but-present Supabase env vars" dev server
// (port 5191, see playwright.config.ts): isRemotePersistenceConfigured()
// is true here, same as real production, so the app should require a
// session instead of falling through to its no-backend local mode.
//
// Fixed 2026-09-27 (found during the migrations 218/219/220 production
// acceptance pass, confirmed unrelated to that work via git-stash
// bisection earlier this same session): this test pre-dates the branded
// login page redesign (HANDOFF.md, 2026-09-23), which replaced the
// plain `.auth-gate`-wrapped sign-in screen with a new `.auth-shell` two-
// panel layout (main.tsx's `requiresSignIn` branch) -- `.auth-gate` is
// still a real class used elsewhere (the loading screen, password-reset,
// guest-channel shell), just never on THIS screen anymore, so the
// locator silently never matched. Asserting on the actual sign-in form
// controls is more robust than either class name -- it fails honestly if
// the gate is ever removed entirely, not just renamed again.
test.describe("sign-in gate", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("blocks the dashboard without a session", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toHaveCount(0);
  });
});

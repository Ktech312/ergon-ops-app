import { test, expect } from "@playwright/test";

// Runs against the "dummy-but-present Supabase env vars" dev server
// (port 5191, see playwright.config.ts): isRemotePersistenceConfigured()
// is true here, same as real production, so the app should require a
// session instead of falling through to its no-backend local mode.
test.describe("sign-in gate", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("blocks the dashboard without a session", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".auth-gate")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toHaveCount(0);
  });
});

import { test, expect } from "@playwright/test";

// Runs against the "no Supabase env vars" dev server (port 5190, see
// playwright.config.ts) -- persistence isn't configured, so the app skips
// the sign-in gate and goes straight to the dashboard. That's what lets
// these specs exercise real navigation and the real mobile shell without
// a live backend or a logged-in session.

test.describe("primary navigation", () => {
  test("loads the dashboard and switches tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Inventory & Purchasing" }).click();
    await expect(page.getByRole("heading", { name: "Inventory & Purchasing" })).toBeVisible();

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("a company with zero projects and zero equipment types does not crash the app", async ({ page }) => {
    // Regression test for a real crash found during mobile-shell
    // verification: with an empty deviceRecipes/projectSites array, both
    // the Inventory and Projects screens threw on render (reading
    // .components / .id of undefined) instead of showing an empty state.
    await page.goto("/");

    await page.getByRole("button", { name: "Inventory & Purchasing" }).click();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Inventory & Purchasing" })).toBeVisible();

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });
});

test.describe("mobile application shell", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows exactly one primary nav, not the desktop strip", async ({ page }) => {
    await page.goto("/");

    const bottomNav = page.locator(".mobile-bottom-nav");
    await expect(bottomNav).toBeVisible();

    // .nav-list is the desktop tab strip -- regression test for it being
    // visible as a horizontally-clipped strip on top of the bottom nav.
    const desktopNav = page.locator(".nav-list");
    await expect(desktopNav).toBeHidden();
  });

  test("the center action never duplicates an adjacent nav destination", async ({ page }) => {
    await page.goto("/");
    const centerLabel = page.locator(".mobile-nav-center-label");
    await expect(centerLabel).toBeVisible();
    const dashboardTabLabel = page.locator(".mobile-nav-tab span", { hasText: "Dashboard" });
    await expect(dashboardTabLabel).toBeVisible();
    await expect(centerLabel).not.toHaveText(await dashboardTabLabel.textContent());
  });

  test("navigating tabs on mobile does not crash, and a modal hides the bottom nav", async ({ page }) => {
    await page.goto("/");
    await page.locator(".mobile-nav-tab", { hasText: "Inventory" }).click();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Equipment BOM" }).click();
    await expect(page.locator(".modal-backdrop")).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
  });
});

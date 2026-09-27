import { test, expect } from "@playwright/test";

// Production acceptance follow-up (2026-09-27), E's own explicit
// requirement: "Marketing may retain read-only access for attribution,
// reporting, and conversion history, but cannot edit the quote." This is
// enforced today with zero new restriction, purely because
// DEFAULT_TABS_BY_ROLE.marketing (main.tsx) never includes "sales" -- a
// marketing-role-only session's allowedTabs never reach the Sales tab at
// all, so SalesQuoteBuilder's edit controls are unreachable by
// construction. This test proves that access-control fact directly,
// closing the one verification gap the design left as "true by reading
// the code" rather than "true by an automated check."

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Marketing role: no access to the Sales tab (and therefore no quote edit access)", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a marketing-only role session sees Marketing/Reports/Tasks but never Sales", async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

    await context.route(/\/rest\/v1\//, jsonRoute([]));
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "marketing-user@example.com" },
    }));
    await context.route(/\/rest\/v1\/rpc\//, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: false }]));
    await context.route(/\/rest\/v1\/app_user_status/, jsonRoute([{ user_id: "u1", approval_status: "approved", expires_at: null, has_seen_welcome: true }]));
    await context.route(/\/rest\/v1\/company_branding/, jsonRoute([{ workspace_id: "ws-ktech", company_name: "K-Tech Systems", logo_storage_path: null, show_reference_packages: false }]));

    await context.route(/\/rest\/v1\/app_user_roles/, (route) => {
      const url = route.request().url();
      if (url.includes("select=allowed_views")) {
        // No per-user override -- falls back to DEFAULT_TABS_BY_ROLE.marketing.
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ allowed_views: null }]) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ role_key: "marketing" }]) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("marketing-user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    const topNav = page.locator("nav.nav-list");
    await expect(topNav.getByRole("button", { name: "Marketing", exact: true })).toBeVisible();
    await expect(topNav.getByRole("button", { name: "Reports", exact: true })).toBeVisible();
    await expect(topNav.getByRole("button", { name: "Sales", exact: true })).toHaveCount(0);
    await expect(topNav.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);

    // Belt and suspenders: even forcing the hash directly never renders
    // the Sales Quote builder for this role, since allowedTabs (computed
    // from DEFAULT_TABS_BY_ROLE.marketing) gates the view's render, not
    // just the nav button's visibility.
    await page.evaluate(() => { window.location.hash = "sales"; });
    await page.waitForTimeout(700);
    await expect(page.getByText(/Sales Quote/i)).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });
});

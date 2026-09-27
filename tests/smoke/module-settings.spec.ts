import { test, expect } from "@playwright/test";

// Phase 4 guided onboarding (migration 218): proves the frontend side of
// "enabled modules" end-to-end -- a workspace-admin session whose company
// has already disabled Support (a862 GET returning that module_key) sees
// it removed from top navigation, gets redirected away from a direct
// #support URL, and can re-enable it from Admin > Module Settings, which
// fires the real set_workspace_module_enabled RPC.

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Module Settings: disabled modules are hidden, blocked, and re-enable-able", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a workspace admin session with Support disabled hides it from nav, blocks direct URL access, and can re-enable it", async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

    await context.route(/\/rest\/v1\//, jsonRoute([]));
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "vltdadmin@example.com" },
    }));
    await context.route(/\/rest\/v1\/rpc\/set_workspace_module_enabled/, jsonRoute(null));
    await context.route(/\/rest\/v1\/rpc\//, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: true }]));
    await context.route(/\/rest\/v1\/app_user_roles/, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_user_status/, jsonRoute([{ user_id: "u1", approval_status: "approved", expires_at: null, has_seen_welcome: true }]));
    await context.route(/\/rest\/v1\/company_branding/, jsonRoute([{ workspace_id: "ws-ktech", company_name: "K-Tech Systems", logo_storage_path: null, show_reference_packages: false }]));

    let lastSetModulePayload: Record<string, unknown> | null = null;
    await context.route(/\/rest\/v1\/workspace_enabled_modules/, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ module_key: "support", enabled: false }]) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await context.route(/\/rest\/v1\/rpc\/set_workspace_module_enabled/, (route) => {
      lastSetModulePayload = JSON.parse(route.request().postData() || "{}");
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    // Nav hiding: the Support tab must not be in the top nav at all.
    await expect(page.getByRole("button", { name: "Support", exact: true })).toHaveCount(0);

    // Direct URL access: forcing the hash to #support must bounce back to
    // #dashboard rather than rendering the Support view for a disabled module.
    await page.evaluate(() => { window.location.hash = "support"; });
    await page.waitForTimeout(700);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#dashboard");

    // Admin > Module Settings: Support shows unchecked; re-enabling it
    // calls the real RPC with the right module key and value.
    await page.locator(".account-menu-trigger").click();
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.waitForTimeout(700);

    await expect(page.getByRole("heading", { name: "Module Settings" })).toBeVisible();
    const supportCheckbox = page.locator(".module-settings-row", { hasText: "Support" }).locator("input[type=checkbox]");
    await expect(supportCheckbox).not.toBeChecked();

    await supportCheckbox.check();
    await page.waitForTimeout(500);

    expect(lastSetModulePayload).toEqual({ p_module_key: "support", p_enabled: true });
    expect(consoleErrors).toEqual([]);
  });
});

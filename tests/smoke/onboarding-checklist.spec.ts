import { test, expect } from "@playwright/test";

// Phase 4 guided onboarding (migration 219): proves the Onboarding
// Checklist panel end-to-end -- a workspace admin sees the 5-step
// checklist with one step already marked done (from the mocked GET),
// can mark another step done (firing the real RPC), and can reopen a
// completed step back to pending.

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Onboarding Checklist: progress persists and can be updated", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a workspace admin sees checklist progress and can mark a step done", async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

    await context.route(/\/rest\/v1\//, jsonRoute([]));
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "vltdadmin@example.com" },
    }));
    await context.route(/\/rest\/v1\/rpc\//, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: true }]));
    await context.route(/\/rest\/v1\/app_user_roles/, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_user_status/, jsonRoute([{ user_id: "u1", approval_status: "approved", expires_at: null, has_seen_welcome: true }]));
    await context.route(/\/rest\/v1\/company_branding/, jsonRoute([{ workspace_id: "ws-ktech", company_name: "K-Tech Systems", logo_storage_path: null, show_reference_packages: false }]));
    await context.route(/\/rest\/v1\/workspace_enabled_modules/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_onboarding_progress/, jsonRoute([{ step_key: "company_branding", status: "done" }]));

    let lastPayload: Record<string, unknown> | null = null;
    await context.route(/\/rest\/v1\/rpc\/set_onboarding_step_status/, (route) => {
      lastPayload = JSON.parse(route.request().postData() || "{}");
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    await page.locator(".account-menu-trigger").click();
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.waitForTimeout(700);

    await expect(page.getByRole("heading", { name: "Onboarding Checklist" })).toBeVisible();

    const brandingRow = page.locator(".onboarding-checklist-row", { hasText: "Add your logo" });
    await expect(brandingRow.getByText("Done", { exact: true })).toBeVisible();

    const teamRow = page.locator(".onboarding-checklist-row", { hasText: "Invite your team" });
    await teamRow.getByRole("button", { name: "Mark done" }).click();
    await page.waitForTimeout(500);

    expect(lastPayload).toEqual({ p_step_key: "team_invited", p_status: "done" });
    await expect(teamRow.getByText("Done", { exact: true })).toBeVisible();

    await brandingRow.getByRole("button", { name: "Reopen" }).click();
    await page.waitForTimeout(500);
    expect(lastPayload).toEqual({ p_step_key: "company_branding", p_status: "pending" });
    await expect(brandingRow.getByRole("button", { name: "Mark done" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

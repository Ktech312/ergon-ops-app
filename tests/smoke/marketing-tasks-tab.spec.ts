import { test, expect } from "@playwright/test";

// Phase 5 (Marketing depth): the Marketing section's own Discussion
// channel already received onCreateTask/onUpdateTask/onDeleteTask props
// identically to every other section's channel -- the one real gap was
// that "marketing" had no TaskSection value and no entry in
// SECTION_CHANNEL_TASK_SECTIONS, so channelHasTaskSupport() always
// returned false for it and its Tasks tab never rendered. This proves
// the fix: with a real "marketing" section channel present, the
// Discussion view's Tasks tab now shows up, matching Projects/Inventory/
// Sales.

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Marketing: Discussion channel now supports a Tasks tab", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("the marketing section channel's Discussion view shows a working Tasks tab", async ({ page, context }) => {
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
    await context.route(/\/rest\/v1\/channels/, jsonRoute([
      { id: "chan-marketing", type: "section", section_key: "marketing", project_id: null, client_id: null, name: "Marketing", private: false, created_by: null },
    ]));

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    await page.evaluate(() => { window.location.hash = "marketing"; });
    await page.waitForTimeout(700);

    await page.getByRole("button", { name: "Discussion", exact: true }).click();
    await page.waitForTimeout(700);

    const tasksTabButton = page.getByRole("main").getByRole("button", { name: "Tasks", exact: true });
    await expect(tasksTabButton).toBeVisible();
    await tasksTabButton.click();
    await page.waitForTimeout(500);

    expect(consoleErrors).toEqual([]);
  });
});

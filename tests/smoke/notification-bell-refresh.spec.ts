import { test, expect } from "@playwright/test";

// Regression for the 2026-10-04 functional walkthrough: the notification bell
// was loaded once per session, so a notification created by someone/something
// else (a client's proposal question, a teammate assigning a task) never
// appeared until a full page reload. The bell now refreshes on a timer while
// the tab is visible.

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Notification bell: picks up new notifications without a reload", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a notification created after sign-in shows up within a minute", async ({ page, context }) => {
    await page.clock.install();

    await context.route(/\/rest\/v1\//, jsonRoute([]));
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "member@example.com" },
    }));
    await context.route(/\/rest\/v1\/rpc\//, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: true }]));
    await context.route(/\/rest\/v1\/app_user_roles/, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_user_status/, jsonRoute([{ user_id: "u1", approval_status: "approved", expires_at: null, has_seen_welcome: true }]));
    await context.route(/\/rest\/v1\/company_branding/, jsonRoute([{ workspace_id: "ws-1", company_name: "Smoke Co", logo_storage_path: null, show_reference_packages: false }]));

    let notificationLoads = 0;
    let rows: Array<Record<string, unknown>> = [];
    await context.route(/\/rest\/v1\/notifications\?/, (route) => {
      notificationLoads += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("member@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("button", { name: "Notifications" }).waitFor();
    const loadsAfterSignIn = notificationLoads;
    expect(loadsAfterSignIn).toBeGreaterThan(0);

    rows = [{
      id: "n1", recipient_email: "member@example.com", event_type: "proposal_question_received",
      title: "New question on a proposal", body: "ZZ client asked a question", related_entity_type: "sales_quote",
      related_entity_id: "q1", dedupe_key: "k1", is_read: false, created_at: new Date().toISOString(), created_by: null,
    }];

    await page.clock.fastForward(61_000);
    await expect.poll(() => notificationLoads).toBeGreaterThan(loadsAfterSignIn);

    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByText("New question on a proposal")).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

// Phase 5 (Marketing depth), migration 220: proves the lead capture ->
// qualify -> convert flow end-to-end through the real UI -- a workspace
// member creates a lead, moves it through qualifying -> qualified, then
// converts it into a Sales Quote via the real RPC, with no console
// errors along the way.

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("Marketing Leads: create, qualify, convert", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a workspace member can add a lead, qualify it, and convert it to a Sales Quote", async ({ page, context }) => {
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
    await context.route(/\/rest\/v1\/marketing_lead_activity/, jsonRoute([]));

    let leads: Array<Record<string, unknown>> = [];
    await context.route(/\/rest\/v1\/marketing_leads(\?|$)/, (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const created = { id: "lead-1", ...body, status: "new", disqualified_reason: null, owner_email: null, converted_sales_quote_id: null, converted_by: null, converted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        leads = [created];
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([created]) });
      }
      if (route.request().method() === "PATCH") {
        const patch = JSON.parse(route.request().postData() || "{}");
        leads = leads.map((lead) => ({ ...lead, ...patch }));
        return route.fulfill({ status: 204, contentType: "application/json", body: "" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(leads) });
    });

    // Regression (2026-10-04 functional walkthrough): converting a lead used
    // to leave the Sales tab's session-scoped quote list stale until a full
    // page reload. Count GETs so the test can prove a reload fires on convert.
    let salesQuoteLoads = 0;
    await context.route(/\/rest\/v1\/sales_quotes\?/, (route) => {
      if (route.request().method() === "GET") salesQuoteLoads += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    let convertCalled = false;
    await context.route(/\/rest\/v1\/rpc\/convert_marketing_lead_to_quote/, (route) => {
      convertCalled = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "quote-1", quote_ref: "SQ-2026-0099" }) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    await page.evaluate(() => { window.location.hash = "marketing"; });
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Leads", exact: true }).click();
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Add Lead", exact: true }).click();
    await page.getByLabel("Company name *").fill("Acme Corp");
    await page.getByLabel("Lead source *").fill("website_form");
    await page.getByRole("button", { name: "Save Lead", exact: true }).click();
    await page.waitForTimeout(500);

    await expect(page.getByText("Acme Corp")).toBeVisible();
    await page.getByText("Acme Corp").click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Start Qualifying", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Mark Qualified", exact: true }).click();
    await page.waitForTimeout(400);

    const convertButton = page.getByRole("button", { name: "Convert to Sales Quote", exact: true });
    await expect(convertButton).toBeVisible();
    const loadsBeforeConvert = salesQuoteLoads;
    await convertButton.click();
    await page.waitForTimeout(500);

    expect(convertCalled).toBe(true);
    expect(salesQuoteLoads).toBeGreaterThan(loadsBeforeConvert);
    await expect(page.getByText("Converted to Sales Quote SQ-2026-0099.")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

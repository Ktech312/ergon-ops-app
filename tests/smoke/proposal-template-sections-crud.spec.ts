import { test, expect } from "@playwright/test";

// Migration 216, per E's own explicit decision: proposal_template_sections
// is now workspace-scoped with real create/delete capability, so K-Tech
// (and every future company) can build their own proposal boilerplate
// from scratch instead of either sharing Ergon's or having no way to add
// one at all. Verifies the actual UI, not just the RLS migration --
// exactly the kind of thing this session's own exploratory pass found
// value in doing for the rest of the onboarding flow.

test.describe("proposal template sections: create, edit, delete", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a workspace admin can add, edit, and delete their own company's proposal template section", async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
    // handleDeleteProposalTemplateSection uses window.confirm() --
    // Playwright auto-dismisses dialogs unless handled explicitly.
    page.on("dialog", (dialog) => dialog.accept());

    // Catch-all FIRST -- routes are invoked in reverse registration
    // order, so this must be registered before the specific overrides.
    await context.route(/\/rest\/v1\//, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

    await context.route(/\/auth\/v1\/token\?grant_type=password/, (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "vltdadmin@example.com" } }),
      })
    );
    await context.route(/\/rest\/v1\/rpc\//, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ outcome: "none_pending", joined_workspace_id: null }]) }));
    await context.route(/\/rest\/v1\/app_admins/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await context.route(/\/rest\/v1\/platform_admins/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ is_workspace_admin: true }]) }));
    await context.route(/\/rest\/v1\/app_user_roles/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await context.route(/\/rest\/v1\/app_user_status/, (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([{ user_id: "u1", approval_status: "pending" }]) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "u1", approval_status: "pending", expires_at: null, has_seen_welcome: true }]) });
    });
    await context.route(/\/rest\/v1\/company_branding/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ workspace_id: "ws-ktech", company_name: "K-Tech Systems", logo_storage_path: null, show_reference_packages: false }]) }));

    let sections: Array<{ id: string; section_key: string; title: string; body: string; sequence_order: number; updated_at: string }> = [];
    let nextId = 1;
    await context.route(/\/rest\/v1\/proposal_template_sections/, (route) => {
      const method = route.request().method();
      if (method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sections) });
      }
      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const row = { id: `sec-${nextId++}`, section_key: `key-${nextId}`, title: body.title, body: body.body, sequence_order: body.sequence_order, updated_at: new Date().toISOString() };
        sections.push(row);
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([row]) });
      }
      if (method === "PATCH") {
        const url = new URL(route.request().url());
        const id = url.searchParams.get("id")?.replace("eq.", "");
        const body = JSON.parse(route.request().postData() || "{}");
        sections = sections.map((s) => (s.id === id ? { ...s, ...body } : s));
        return route.fulfill({ status: 204, contentType: "application/json", body: "" });
      }
      if (method === "DELETE") {
        const url = new URL(route.request().url());
        const id = url.searchParams.get("id")?.replace("eq.", "");
        sections = sections.filter((s) => s.id !== id);
        return route.fulfill({ status: 204, contentType: "application/json", body: "" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForTimeout(1500);

    await page.locator(".account-menu-trigger").click();
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.waitForTimeout(700);

    await expect(page.getByText("No template sections yet")).toBeVisible();

    await page.getByRole("button", { name: "Add Section" }).click();
    await page.waitForTimeout(700);

    const titleInput = page.locator(".proposal-template-title-input");
    await expect(titleInput).toHaveValue("New Section");

    await titleInput.fill("Standard Warranty");
    await titleInput.blur();
    await page.waitForTimeout(500);

    await expect(page.locator(".proposal-template-section-row")).toHaveCount(1);

    await page.getByRole("button", { name: /Delete Standard Warranty|Delete New Section/ }).click();
    await page.waitForTimeout(500);

    await expect(page.getByText("No template sections yet")).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

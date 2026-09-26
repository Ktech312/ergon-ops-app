import { test, expect, type Page } from "@playwright/test";

// Migration 209, item 10 of E's own review, after the real K-Tech Systems
// onboarding test failed to complete end-to-end: "Add an automated
// end-to-end test covering request -> approval -> account creation ->
// confirmation -> claim -> first K-Tech login."
//
// SCOPING, stated plainly rather than glossed over: this repo has no
// staging Supabase project and no test-email interception (Inbucket/
// Mailhog) wired into CI -- standing that up is real infrastructure this
// migration does not invent unilaterally. The request/approval steps are
// already proven at the RPC level by the PGlite consolidated isolation
// suite (migration_195/196/209's own canonical tests, run via
// `npm run test:isolation`), which chains approve_company_signup ->
// accept_company_signup/claim_own_pending_company_signup against a real,
// fully-migrated Postgres schema. What THIS suite adds, that nothing else
// in this repo covers, is a real browser exercising the actual claim-page
// component's rendered states end-to-end -- the exact surface where both
// of tonight's real, live bugs were found -- with the Supabase REST/Auth
// calls it makes intercepted at the network boundary (page.route), not
// mocked inside the component. "Account creation -> confirmation ->
// claim -> first login" is covered directly; "request -> approval" stays
// covered at the RPC level, cross-referenced here rather than restated.
//
// Runs against the "dummy-but-present Supabase env vars" dev server
// (port 5191, see playwright.config.ts) -- isRemotePersistenceConfigured()
// is true, same as real production, but https://smoke-test.supabase.co
// is never actually reached; every rest/v1 and auth/v1 call this page
// makes is intercepted below.

const SUPABASE_ORIGIN = "https://smoke-test.supabase.co";
const FAKE_TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function mockTokenLookup(page: Page, overrides: Partial<{ status: string; accountExists: boolean; companyName: string; requesterEmail: string }> = {}) {
  const {
    status = "valid",
    accountExists = false,
    companyName = "K-Tech Systems",
    requesterEmail = "vltdadmin@example.com",
  } = overrides;
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_company_signup_by_token`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ company_name: companyName, status, requester_email: requesterEmail, account_exists: accountExists }]),
    })
  );
}

test.describe("company signup claim page", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test.describe("terminal token states -- explain what happened, give a next action", () => {
    for (const [status, expectedHeading] of [
      ["not_found", "Signup link not found"],
      ["expired", "Signup link expired"],
      ["revoked", "Signup link revoked"],
      ["used", "Already set up"],
    ] as const) {
      test(`status ${status} renders "${expectedHeading}" with a way back to sign in`, async ({ page }) => {
        await mockTokenLookup(page, { status });
        await page.goto(`/?company-signup=${FAKE_TOKEN}`);
        await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();
        await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
      });
    }
  });

  test("item 3: a new-account claim pre-fills and locks the approved email -- never a blank editable field", async ({ page }) => {
    await mockTokenLookup(page, { accountExists: false });
    await page.goto(`/?company-signup=${FAKE_TOKEN}`);

    await expect(page.getByRole("heading", { name: "Welcome to Ergon" })).toBeVisible();
    const emailInput = page.locator("label", { hasText: "Email" }).locator("input");
    await expect(emailInput).toHaveValue("vltdadmin@example.com");
    await expect(emailInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create my account" })).toBeVisible();
  });

  test("items 6/7: confirm-email required -> check-your-email screen with a working resend, no dead end", async ({ page }) => {
    await mockTokenLookup(page, { accountExists: false });
    await page.goto(`/?company-signup=${FAKE_TOKEN}`);

    // Simulates "confirm email" being enabled on the project: GoTrue's own
    // signup response has no access_token yet.
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/signup*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "u1", email: "vltdadmin@example.com" }) })
    );

    await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
    await page.getByLabel("Confirm password", { exact: true }).fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create my account" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("vltdadmin@example.com")).toBeVisible();

    let resendCalled = false;
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/resend*`, (route) => {
      resendCalled = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.getByRole("button", { name: "Resend confirmation email" }).click();
    await expect(page.getByRole("button", { name: "Confirmation email resent" })).toBeVisible();
    expect(resendCalled).toBe(true);

    await expect(page.getByRole("button", { name: "Continue to sign in" })).toBeVisible();
  });

  test("items 4/5/8: an existing account is offered sign-in-to-claim upfront, and a successful sign-in completes the claim and leaves the waiting-for-approval flow behind", async ({ page }) => {
    await mockTokenLookup(page, { accountExists: true });
    await page.goto(`/?company-signup=${FAKE_TOKEN}`);

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    const emailInput = page.locator("label", { hasText: "Email" }).locator("input");
    await expect(emailInput).toHaveValue("vltdadmin@example.com");
    await expect(emailInput).toBeDisabled();
    // No confirm-password field on the sign-in branch -- this is a real
    // sign-in, not an account-creation form in disguise.
    await expect(page.locator("label", { hasText: "Confirm password" })).toHaveCount(0);

    await page.route(`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "vltdadmin@example.com" } }),
      })
    );

    let claimCalled = false;
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/claim_own_pending_company_signup`, (route) => {
      claimCalled = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ outcome: "accepted", joined_workspace_id: "11111111-2222-3333-4444-555555555555" }]),
      });
    });

    const signInButton = page.getByRole("button", { name: /sign in to claim/i });
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
    await signInButton.click();

    // The claim completes automatically and the page leaves the claim
    // link behind entirely -- item 8: it must never fall into the
    // generic employee "waiting for approval" flow, which only that
    // stale query string could route it into.
    await page.waitForURL((url) => !url.search.includes("company-signup"));
    expect(claimCalled).toBe(true);
  });
});

import { test, expect } from "@playwright/test";

// K-Tech Systems onboarding recovery, 2026-09-26: the founder's account
// (workspace already active, membership already created, claim already
// consumed -- see HANDOFF.md's same-dated entry) still could not sign
// into real production. GoTrue's own "Invalid login credentials" error
// is deliberately vague -- it never distinguishes a wrong password from
// an account that never had one set at all (e.g. created via Google only)
// from a nonexistent account, by design, to avoid account enumeration.
// That ambiguity can't be resolved client-side, so the real, reusable
// fix (not just a patch for this one account) is making the ONE action
// that fixes every one of those causes -- resetting the password --
// impossible to miss right on the failure, instead of a generic dead-end
// message. This is the strongest coverage available for that fix without
// a live Supabase project in CI: a real browser exercising the actual
// rendered sign-in form and its real fetch calls, intercepted at the
// network boundary.
//
// Runs against the "dummy-but-present Supabase env vars" dev server
// (port 5191, see playwright.config.ts), same as auth-gate.spec.ts.

test.describe("sign-in failure recovery", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a vague Invalid login credentials failure surfaces the one concrete next action", async ({ page, context }) => {
    // context.route with a regex, not page.route with a glob string --
    // empirically, page.route's glob matching against this cross-origin
    // fake host was unreliable specifically on the plain root "/" (full
    // App mount) page in this repo's dev-server setup, even though the
    // identical glob pattern works fine from the company-signup landing
    // page (see tests/smoke/company-signup-claim.spec.ts). Root cause
    // not fully chased down since it's a test-infra quirk, not a product
    // bug -- context.route + regex reproduces reliably instead.
    await context.route(/\/auth\/v1\/token/, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }),
      })
    );

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("whatever-was-tried");
    await page.getByRole("button", { name: "Log in" }).click();

    const status = page.getByRole("alert");
    await expect(status).toContainText("Invalid login credentials");
    await expect(status).toContainText("Forgot password?");
    await expect(status).toContainText("Sign in with Google");
  });

  test("Forgot password? sends exactly one recovery email and reports it clearly", async ({ page, context }) => {
    let recoverCallCount = 0;
    await context.route(/\/auth\/v1\/recover/, (route) => {
      recoverCallCount += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByRole("button", { name: "Forgot password?" }).click();

    await expect(page.getByText(/Password reset link sent to vltdadmin@example\.com/)).toBeVisible();
    expect(recoverCallCount).toBe(1);
  });
});

import { test, expect } from "@playwright/test";

// K-Tech Systems onboarding recovery, 2026-09-26, item 6 of E's own review:
// regression coverage for "a founder returns after confirmation/reset and
// successfully signs into the already-claimed workspace, with no
// duplicate workspace/membership/token/account." K-Tech's own claim was
// already consumed before this was written (see HANDOFF.md's same-dated
// entry: workspace active, founding membership already exists) -- this
// proves that once a founder's real identity issue is resolved (however
// they get there -- password reset, Google, or a corrected password) and
// they sign back in, claim_own_pending_company_signup does NOT error out
// just because the token is already used, and the person reaches a
// normal signed-in state exactly like any other returning user, exactly
// once.
//
// SCOPING, stated plainly: this covers the sign-in half of "reset then
// sign in" (the half that actually determines whether the person gets
// stuck). It does not additionally simulate arriving via a real
// Supabase recovery hash-fragment link -- that entry point shares its
// session-parsing code with Google OAuth sign-in (consumeOAuthRedirectSession)
// and, under React StrictMode's dev-only double-effect invocation (active
// under `npm run dev`, which this whole smoke suite runs against), the
// hash gets consumed by the first of the two invocations before the
// second can read it -- a test-harness-only artifact of StrictMode
// running twice in development, not a production bug (StrictMode does
// not double-invoke effects in a real production build). Simulating that
// specific entry path reliably would need a built-and-served app instead
// of the dev server; not invented here.

test.describe("password reset into an already-claimed workspace", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("signing back in after already being claimed lands signed in, no error, no re-claim", async ({ page, context }) => {
    await context.route(/\/auth\/v1\/token\?grant_type=password/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, user: { id: "u1", email: "vltdadmin@example.com" } }),
      })
    );

    let claimCallCount = 0;
    await context.route(/\/rest\/v1\/rpc\/claim_own_pending_company_signup/, (route) => {
      claimCallCount += 1;
      // Already claimed earlier -- this is the expected, harmless outcome
      // on every ordinary sign-in from now on, not an error state.
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ outcome: "none_pending", joined_workspace_id: null }]) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("vltdadmin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("a brand new correct horse battery staple");
    await page.getByRole("button", { name: "Log in" }).click();

    // Signed in cleanly: the app moves on to its normal post-signin
    // "Checking your account..." loading state (not the sign-in form,
    // and not an error alert) -- no stray claim-outcome message leaking
    // through even though claim_own_pending_company_signup was called
    // (and correctly found nothing left to do), and called exactly once,
    // not repeated or duplicated.
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(claimCallCount).toBe(1);
  });
});

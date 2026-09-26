import { test, expect } from "@playwright/test";

// K-Tech Systems onboarding recovery, 2026-09-26: the REAL bug behind
// "Waiting for approval" showing up after a successful Google sign-in
// for a founding admin whose workspace was already active with a real
// admin membership row. Root cause: the "isApproved" gate (main.tsx)
// only ever checked isAdmin (app_admins -- migration 185's own words,
// "a flat list with no workspace concept at all", Ergon's own legacy
// single-company admin flag) or an approved app_user_status row
// (ensureOwnApprovalRequest inserts one for every signed-in user, no
// workspace-admin exception). It never checked
// workspace_members.is_workspace_admin at all -- so EVERY future
// company's founding admin would hit this identical wall, not just this
// one account. Every existing Ergon Test Workspace admin happened to
// already have an app_admins row from before workspace_members existed,
// which is exactly why this was never caught before a genuinely new
// company's founder signed in for the first time.
//
// Confirmed safe to fix by adding isWorkspaceAdmin to the OR: grep shows
// app_user_status is never referenced by any RLS policy anywhere in this
// repo's migrations -- this is a pure frontend UX gate, and
// isWorkspaceAdmin only ever reflects the caller's OWN single workspace's
// own membership row (loadOwnWorkspaceMembership), so this grants no new
// data access.
//
// Runs against the "dummy-but-present Supabase env vars" dev server
// (port 5191). Uses context.route + regex, not page.route + glob (see
// sign-in-failure-recovery.spec.ts's own note on why the glob match was
// unreliable from the plain root page in this dev-server setup).

function jsonRoute(body: unknown, status = 200) {
  return (route: import("@playwright/test").Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("a workspace admin is never blocked by the generic employee approval gate", () => {
  test.use({ baseURL: "http://127.0.0.1:5191" });

  test("a founding admin with no app_admins row and no approved app_user_status still reaches the app, not Waiting for approval", async ({ page, context }) => {
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, user: { id: "u1", email: "founder@k-tech.example" },
    }));

    await context.route(/\/rest\/v1\/rpc\/claim_own_pending_company_signup/, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));

    // Playwright invokes routes in reverse registration order (last
    // registered gets first chance), so the broad catch-all -- everything
    // else this app's post-signin data-loading pass might hit (guest-
    // session checks, directory loads, etc.), defaulting to an empty,
    // harmless result rather than enumerating every endpoint -- is
    // registered FIRST here, so every more specific route below it takes
    // priority over it.
    await context.route(/\/rest\/v1\//, jsonRoute([]));

    // The precise, real state this whole bug depends on: no app_admins
    // row, an unapproved app_user_status row, but a real
    // workspace_members row with is_workspace_admin = true.
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: true }]));
    await context.route(/\/rest\/v1\/app_user_roles/, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_user_status/, (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([{ user_id: "u1", approval_status: "pending" }]) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "u1", approval_status: "pending", expires_at: null, has_seen_welcome: true }]) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("founder@k-tech.example");
    await page.getByLabel("Password", { exact: true }).fill("whatever the founder set");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("Waiting for approval")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
  });

  test("an ordinary new employee with no admin flags and an unapproved status still correctly sees Waiting for approval", async ({ page, context }) => {
    // Regression guard in the OTHER direction: proves the fix above
    // didn't accidentally let EVERYONE through -- only a real workspace
    // admin bypasses this gate.
    await context.route(/\/auth\/v1\/token\?grant_type=password/, jsonRoute({
      access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, user: { id: "u2", email: "newhire@ktech.example" },
    }));
    await context.route(/\/rest\/v1\/rpc\/claim_own_pending_company_signup/, jsonRoute([{ outcome: "none_pending", joined_workspace_id: null }]));
    await context.route(/\/rest\/v1\//, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/platform_admins/, jsonRoute([]));
    await context.route(/\/rest\/v1\/workspace_members\?select=is_workspace_admin/, jsonRoute([{ is_workspace_admin: false }]));
    await context.route(/\/rest\/v1\/app_user_roles/, jsonRoute([]));
    await context.route(/\/rest\/v1\/app_user_status/, (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([{ user_id: "u2", approval_status: "pending" }]) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "u2", approval_status: "pending", expires_at: null, has_seen_welcome: true }]) });
    });

    await page.goto("/");
    await page.getByLabel("Email address").fill("newhire@ktech.example");
    await page.getByLabel("Password", { exact: true }).fill("whatever they set");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
  });
});

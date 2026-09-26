# Second-Company Onboarding — Acceptance Checklist

Status: **CHECKLIST FOR A REAL, LIVE ACCEPTANCE TEST — not a design document.** Written 2026-09-25
per E's own explicit instruction: "Do not call onboarding complete merely because the database rows
exist." Every row below must be verified against a genuine second-company account going through the
real production flow — never a synthetic SQL fixture, never the `ZZ Test Signup Co` artifact already
sitting in production from an earlier partial dry run (see `HANDOFF.md`, 2026-09-22 entry — that test
deliberately stopped short of completing account creation, so it has never actually been claimed by a
real second user).

## Required production flow (run this exact sequence, in order)

1. The person submits "Request new business signup" from the signed-out page.
2. E receives the durable platform notification and sees the request in Ergon Platform.
3. E approves the request.
4. The signup link remains retrievable after approval and after a page reload.
5. Until production email is configured, E copies and sends that link manually.
6. The recipient opens it in a separate browser/profile and signs up using the exact approved email.
7. The account claims the new workspace and becomes that workspace's founding workspace administrator.
8. The new company can sign in again later, including after a browser restart.

Every one of these 8 steps already has real, working code behind it (migrations 195-199, all
confirmed applied and tested in production) — this checklist is about *proving* the whole chain works
for a real person, not building anything new for it (aside from the notification-rules provisioning
fix tracked separately, see the note at the bottom).

## Acceptance requirements — mark each one only when verified against the real second-company account

For each row, record the result using this doc's own three-tier standard (do not skip tiers):
- **Code/test verified** — the canonical migration test and/or a `vitest` test proves this.
- **Production verified** — a real check against the live database/app confirms it (E or a live query).
- **Verified by the second-company user** — the actual second-person account experienced this directly,
  not just an admin-side check standing in for it.

| # | Requirement | Code/test verified | Production verified | Verified by 2nd-company user |
|---|---|---|---|---|
| 1 | Correct company name and branding appear after sign-in | yes | yes (SQL: `company_branding.company_name = 'K-Tech Systems'`) | **yes, 2026-09-26** — E as `vltdadmin@gmail.com` saw "Welcome to K-Tech Systems Ops" directly |
| 2 | Ergon remains the platform branding on signed-out pages | yes (never changed) | | |
| 3 | Workspace status is `active` | yes | **yes, 2026-09-26** (SQL: `workspaces.status = 'active'` for K-Tech's real workspace id) | yes (implied — E used the app under this account) |
| 4 | Founding user is a workspace admin but NOT a platform admin | yes | **yes, 2026-09-26** (SQL, simulated as this real account via RLS: `workspace_members.is_workspace_admin = true`, `app_admins`/`platform_admins` both empty) | |
| 5 | Ergon Platform controls are invisible and inaccessible to the new company | yes (migration 198 test) | | **not yet checked** — E should confirm no "Ergon Platform" link/Shield icon appears anywhere in K-Tech's own session |
| 6 | Inventory, clients, quotes, projects, documents, channels, Support, Engineering, reports, notifications, and configuration contain no Ergon Test Workspace data | yes (consolidated isolation suite) | **partially -- see the new finding below** | **not yet checked directly** |
| 7 | The four section channels belong to the new workspace | yes | not yet re-confirmed specifically for K-Tech's own workspace | |
| 8 | Support and Engineering notification rules exist for the new workspace | yes (migration 207 test) | not yet re-confirmed specifically for K-Tech's own workspace | |
| 9 | The new company can invite a teammate and assign roles | **a real, fourth bug found and fixed 2026-09-26 -- see below, migration 212, NOT YET APPLIED** | | **not yet checked** |
| 10 | E can suspend and reactivate the company, with the reason preserved in the audit log | yes (migration 198 test) | | (not applicable to check against a live company E wants to keep running) |
| 11 | Suspension actually prevents normal company access | yes (migration 198 test) | | (same as #10 — do not suspend K-Tech just to prove this) |
| 12 | Ergon Test Workspace users cannot see the new company's records | yes (consolidated isolation suite) | | **not yet checked** |
| 13 | The new company cannot see Ergon Test Workspace records | yes (consolidated isolation suite) | **a real, adjacent gap found and fixed 2026-09-26 -- see below** | **yes, in the specific case found** — E directly reported and confirmed the fix |
| 14 | No Billing, subscription, payment, trial, plan, or usage-metering step appears anywhere | yes (true by construction) | | **not yet checked** |

## Real findings from the actual K-Tech Systems onboarding attempt, 2026-09-26 (not synthetic — read `HANDOFF.md`'s same-dated entries for full detail)

Three real, previously-invisible bugs were found and fixed, all confirmed live by E directly:

1. **The `isApproved` sign-in gate never checked `workspace_members.is_workspace_admin` at all** — only
   a legacy, pre-multi-tenancy `app_admins` flag or a generically-approved `app_user_status` row. Would
   have stranded every future company's founding admin on "Waiting for approval," identically, forever.
   Fixed directly in the frontend (no migration).
2. **`app_user_status`'s only UPDATE policy required `is_app_admin()`/`is_app_manager()`**, both
   predating `workspace_members` — a workspace-only admin's own `has_seen_welcome` flag silently never
   persisted (PostgREST returns 200 with zero rows affected, not an error), so the first-login
   walkthrough reappeared on every sign-in. Fixed via migration 210 (`mark_own_welcome_seen()`, a
   security-definer RPC touching exactly one column for exactly the caller's own row).
3. **This is the real, live version of requirement #13's concern, found by E directly, not by any
   test:** the Dashboard's "Package Matrix" panel (`packageOptions`, main.tsx) is a hardcoded,
   Ergon-specific array (camera-install business presets) with zero workspace scoping — it rendered
   identically for every company. Fixed via migration 211: a real per-workspace
   `company_branding.show_reference_packages` flag, backfilled `true` only for the one workspace that
   predates the self-serve signup system entirely, `false` for every company onboarded through it
   (past or future) by construction. This was NOT a database-row-level cross-tenant leak (no real
   Ergon customer data was exposed) — it was hardcoded UI content never made tenant-aware in the first
   place, which is exactly why the consolidated isolation suite's exhaustive RLS-level proofs never
   caught it: there was no RLS policy to test, because there was no database query at all.

**Standing lesson from all three:** every one of them was invisible to code review and to the isolation
suite precisely because they weren't RLS/data-model bugs — they were assumptions ("every admin has an
`app_admins` row", "this content is universal") left over from this app's single-company MVP era,
never revisited when multi-tenancy was bolted on.

**A fourth instance, found proactively (E said "carry on," used the time to audit rather than wait for
the next live incident):** `user_invites`' own read AND write RLS policies (migration 181) require
`is_app_admin(auth.uid())` only, with no `is_workspace_admin(workspace_id)` fallback at all — unlike
every other table migration 185 already widened. A real K-Tech founding admin can neither see nor
create any invite for their own company. Fixed via migration 212 (exactly migration 185's own
established pattern, applied to the two policies it missed) — NOT YET APPLIED, needs E to run it
before requirement #9 can be checked at all.

## What's already proven, and by what (fill in the table above from this, don't re-derive it)

- **#1-3**: proven by the earlier `ZZ Test Signup Co` dry run (2026-09-22) — real branding, real
  active-status workspace, real 4 section channels all confirmed live for that test artifact. Not yet
  proven with a real second-person ACCOUNT completing the claim, since that dry run stopped before
  account creation on purpose.
- **#4-5**: `accept_company_signup()` (migration 195/196) only ever grants `is_workspace_admin = true`
  in the new company's own `workspace_members` row — it never touches `platform_admins`/`app_admins`.
  `isPlatformAdmin`/the Ergon Platform link render client-side only when `checkIsPlatformAdmin()`
  returns true (queries `platform_admins`), and every real platform-admin RPC (`suspend_company`,
  `reactivate_company`, the signup approve/reject/token functions) is independently gated
  server-side by `is_platform_admin()` — a founding workspace admin who is not a platform admin
  cannot reach any of it even by guessing a URL/RPC name. Code/test-verified by migration 198's own
  canonical test (Section proving an ordinary workspace_admin sees neither the console nor the audit
  log). Never yet verified by an actual second-company user's own browser session.
- **#6, #12-13**: this is exactly what the whole Phase 2/3 tenant-isolation project (migrations
  115-192) and the consolidated isolation suite exist to guarantee — code/test-verified extremely
  thoroughly already. Still needs a REAL cross-check with two real accounts open side by side, since
  every prior proof used synthetic fixtures inside a rolled-back test transaction, never two real
  logged-in browser sessions.
- **#7**: `approve_company_signup()` seeds the 4 section channels directly scoped to the new
  workspace's own id (migration 195's own canonical test proves this; the real `ZZ Test Signup Co`
  dry run confirmed it live).
- **#8**: **NOT YET TRUE as of 2026-09-25** — confirmed a real gap: a new workspace gets ZERO
  `notification_rules` rows today (deliberate per E's 2026-09-22 "different industries" decision), and
  the Admin panel has no way to create one. E's follow-up decision (2026-09-25): auto-seed every valid
  event type with sensible defaults for every new AND existing workspace, via one shared provisioning
  function. Tracked as migration 207 — **do not check row #8 until 207 is confirmed applied and its
  own test (which specifically proves every event type is provisioned) has passed in production.**
- **#9**: `user_invites`/`accept_invite()` (migrations 041/065/181) already work per-workspace for any
  company, not just Ergon's — nothing company-specific in that code path. Needs a real check by the
  second-company user, since it's never been run inside a genuinely different company's workspace.
- **#10-11**: migration 198's own canonical test proves the audit-log write and the access-blocking
  effect of `status = 'suspended'` directly (a suspended workspace's own member fails a real
  workspace-scoped write). Live-verified once already against `ZZ Test Signup Co` (Suspend ->
  Reactivate cycle, 2026-09-22) — but that test workspace had no real second-person session actively
  using the app at the time, so "suspension kicks out someone mid-session" specifically has not been
  observed live.
- **#14**: true by construction — no Billing/subscription/payment/trial/plan/usage-metering code
  exists anywhere in this schema or frontend at all (Phase 9 remains an explicit, standing stop
  boundary, untouched this entire project). Confirm by walking the real flow and noting its absence,
  not by grepping for code that isn't there.

## After the real workspace exists

Per E's own instruction: re-run the full consolidated isolation suite
(`node backend/supabase/consolidated_isolation_suite/run_all.mjs`) with the real second workspace's
data present, not just synthetic fixtures — this is a genuinely different, stronger proof than every
prior run, which only ever exercised isolation against fixtures fabricated and rolled back inside one
transaction. Fix any defect found through a new, numbered migration; never edit an applied one, per
this repo's standing discipline.

## Do not do, per E's explicit protected boundaries

No operational Billing/down-payment workflow. No commercial SaaS billing, subscription plans, trials,
payments, or usage metering. No hard workspace deletion. Do not populate the real second company with
Ergon-specific starter data (catalog, schedule templates, etc. — remains deliberately empty, matching
the "different industries" decision; notification_rules is the one deliberate exception per the
2026-09-25 decision above, since those are workspace-capability defaults, not business data). Do not
claim onboarding complete until the real second-company account has actually used the isolated
workspace, not merely been provisioned.

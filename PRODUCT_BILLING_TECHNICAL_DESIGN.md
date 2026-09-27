# Product Billing/SaaS — Technical Design (Threat Model, Test Plan, Migration Sequencing)

Status: **design-only, companion to `PRODUCT_BILLING_SAAS_DECISIONS.md`.** Built against that
document's own recommended defaults as working assumptions — if E's actual answers differ, the
specific sections below that depend on the changed decision need revisiting, not this whole document.
No migration, RLS policy, or serverless function has been written yet; this is the plan for what those
will look like once E's decisions land, produced now so implementation can start immediately after a
single round of answers rather than needing a second research pass.

## 1. Threat model

| Threat | Mitigation |
|---|---|
| **Webhook forgery** — someone POSTs a fake "payment succeeded" event to `api/stripe-webhook.js` | Verify Stripe's signature header (`stripe-signature`) against the raw request body using the webhook signing secret, via Stripe's own SDK helper, before touching any data. Reject with 400 on failure, no state change, no leaking why in the response body. |
| **Webhook replay** — Stripe (or an attacker replaying a captured request) delivers the same event twice | A new `stripe_webhook_events` table keyed on Stripe's own event id (`unique`), checked-and-inserted atomically before processing; a duplicate id is a silent no-op, not reprocessed. Matches this codebase's own established idempotency discipline (e.g. `on conflict do nothing` patterns already used for ref-counter tables). |
| **Cross-tenant billing data leak** — workspace A reads/writes workspace B's plan, card-on-file status, or invoice history | `workspace_billing` gets the exact same RLS shape as every other workspace-scoped table this session built: `is_workspace_member(workspace_id)` for read, `is_active_workspace_member(workspace_id) and is_workspace_admin(workspace_id)` (or `is_app_admin`) for write — no new pattern invented, reusing migrations 218/219/220's own proven shape and their exact canonical-test structure (synthetic workspace A/B, cross-workspace section). |
| **Privilege escalation** — an ordinary workspace member (not admin) changes the plan or cancels billing | All billing-mutating actions go through a SECURITY DEFINER RPC (`set_workspace_plan`, `cancel_workspace_subscription`, etc.), each checking `is_workspace_admin`/`is_app_admin` explicitly inside the function body — never relying on RLS alone for an action this consequential, matching the established pattern from `suspend_company()`/`convert_marketing_lead_to_quote()`. |
| **Card data touching Ergon's own servers** | Structurally prevented by the Q2.2 Stripe Checkout recommendation — card entry happens entirely on Stripe's own hosted page; Ergon's backend never receives a PAN, CVV, or raw card token. |
| **Stale/out-of-order webhook state** — Stripe delivers events out of sequence, an old "past_due" event arrives after a newer "active" one | Never trust a webhook payload's snapshot for the CURRENT authoritative state of a subscription that has since changed — on any ambiguity (event timestamp older than the row's own `updated_at`), re-fetch the subscription object fresh from the Stripe API before writing, rather than blindly applying the webhook body. |
| **Suspension bypass** — a `past_due`/expired-trial workspace's members keep full read/write access anyway | The exact same chokepoint that already blocks a `'suspended'` workspace today — `resolve_caller_workspace_id()` (migration 117) — gets a widened check (or a sibling function) so `past_due`/expired-trial workspaces are blocked the identical way, not a second, parallel enforcement path that could drift out of sync. |
| **Secrets exposure** — Stripe secret key or webhook signing secret ends up client-visible | Both live only as server-only Vercel env vars (`process.env`, never `import.meta.env`/`VITE_*`), matching the existing `GMAIL_APP_PASSWORD` pattern exactly; never logged, including in error messages. |
| **Ergon's own workspace accidentally billed** | The "comped" flag (Q1.4) is checked as an explicit early-return in every billing-mutating RPC and in the webhook handler's own workspace-resolution step — not merely "no cron job happens to target it." |
| **Signup/trial abuse** (spam trial accounts) | Explicitly out of scope for this pass — flagged, not solved. Existing `company_signup_requests` approval-gate (a human reviews every new company today) already provides a first, if manual, backstop. |

## 2. Test plan (must pass before any real charge is ever taken)

Mirrors this session's own established discipline: a canonical `begin;`/`rollback;` SQL test per
migration, run against the consolidated isolation suite, plus Playwright coverage for the UI surface.

1. **Workspace isolation, billing data** — synthetic workspace A/B: A's admin can read/write A's own
   `workspace_billing` row; cannot read or write B's. A platform admin can read/write any workspace's
   row (matching `is_app_admin`'s existing bypass shape elsewhere). An ordinary (non-admin) member of A
   can read but not write A's own row (view-only, per Q4.1).
2. **Webhook signature rejection** — a request with a missing/invalid `stripe-signature` header is
   rejected (400), and zero rows change as a result.
3. **Webhook idempotency** — the same Stripe event id delivered twice results in exactly one state
   change, not two (e.g. not double-extending a trial or double-logging an audit row).
4. **Trial-expiry transition** — a workspace whose `trial_ends_at` has passed and has no active
   subscription flips to the read-only enforcement from Q1.3, verified the same way migration 218
   proved module-disable enforcement: blocked writes, blocked direct URL access to write actions,
   preserved data, real automated Playwright coverage of the read-only banner/CTA.
5. **Grace-period timing** — a `past_due` workspace inside its grace window still has full access; past
   the grace window it's blocked the same way an expired trial is.
6. **Suspension preserves data** — a billing-suspended workspace's rows are all still present and
   intact via a direct postgres-role query, reactivating restores full access with zero data loss —
   same assertion shape as migration 218's own Section (d)/(f).
7. **Reactivation on payment** — a successful-payment webhook event transitions `past_due` back to
   `active` and immediately restores access within the same request cycle a real user would experience.
8. **Seat-cap soft-block** — inviting a teammate beyond the plan's seat cap is rejected with a clear,
   actionable error (not a silent failure), while inviting within the cap succeeds normally.
9. **Permission boundaries** — re-run migration 218/219's own "ordinary member cannot" /
   "global app_admin can act on a workspace they belong to" /
   "a different workspace's admin cannot touch this one" sections, adapted to the new billing RPCs,
   proving no drift from the established permission model.
10. **Comped-workspace exemption** — a workspace flagged comped never transitions to `past_due` or
    `suspended` regardless of any webhook event delivered against it, and is excluded from any future
    billing-reminder/dunning email job.
11. **Full regression** — the entire consolidated isolation suite (all files, not just the new ones)
    stays green after adding the billing tables/RLS/RPCs — the same bar every migration this session was
    already held to.

## 3. Migration sequencing (order only — no SQL written yet)

1. **`workspace_billing`** — `workspace_id` (unique, fk `workspaces`), `stripe_customer_id`,
   `stripe_subscription_id`, `plan_key`, `seat_cap`, `status` (`'trialing'|'active'|'past_due'|
   'canceled'|'comped'`), `trial_ends_at`, `current_period_end`, `is_comped`, `created_at`/`updated_at`.
   RLS per the threat-model table above. One row per workspace, created at workspace-creation time
   (trial started automatically per Q1.3).
2. **`stripe_webhook_events`** — `stripe_event_id` (unique), `event_type`, `processed_at`, `payload`
   (jsonb, for audit/debugging). Written first, atomically, before any side effect of processing the
   event — the idempotency guard from the threat model.
3. **`workspace_billing_audit_log`** — separate from `company_admin_audit_log` (per decision Q3.1),
   append-only, records every plan change/suspension/reactivation with its cause (`'payment_failed'`,
   `'admin_action'`, `'user_canceled'`, `'trial_expired'`), mirroring `company_admin_audit_log`'s own
   shape (migration 198) but for billing-specific, often system-triggered events.
4. **Extend the suspension chokepoint** — widen `resolve_caller_workspace_id()` (or add a sibling
   function called from the same call sites) to also block `past_due`/expired-trial workspaces, the
   identical way `'suspended'` already blocks today — a small, surgical change to one already-proven
   chokepoint, not a second enforcement path.
5. **Plan-to-modules mapping** — however Q1.2 is answered, wire plan tiers into
   `workspace_enabled_modules`'s existing defaults (a new small mapping table, or a fixed constant in
   the plan-assignment RPC) rather than inventing a second feature-gating mechanism.
6. **Seat-cap enforcement** (only if Q7's soft-block is confirmed) — a check inside the existing invite-
   creation RPC path, rejecting beyond `seat_cap`.
7. **`api/stripe-webhook.js`** — the new unauthenticated-inbound-webhook endpoint (flagged in the
   decision doc as structurally novel for this codebase); signature verification, idempotency insert,
   then updates `workspace_billing` + logs to `workspace_billing_audit_log`.
8. **`api/create-billing-portal-session.js`** — authenticated (reuses `requireAuth.js`/a workspace-admin
   check), creates a Stripe Customer Portal session so a workspace admin manages their own plan/card/
   invoices entirely on Stripe's hosted UI — no custom billing-management UI to build or secure.
9. **Frontend**: an Admin "Billing" panel (plan name, seat usage, trial/grace countdown, a single
   "Manage Billing" button opening the Stripe Portal session from step 8) plus a read-only/past-due
   banner reusing the same visual/interaction pattern this session already built for a disabled module
   (blocked writes, clear explanatory copy, a path back to good standing) rather than a new UI paradigm.

## 4. Rollout order

Build and fully exercise everything above against **Stripe test mode** first — test-mode keys in every
non-production Vercel environment, a complete pass of the full test plan (§2) against test-mode
webhooks and a real (test-card) Checkout session — before any live key is ever placed in production Vercel
env vars. Migrations still go out one file at a time with E's own confirmation, per this project's
standing discipline; nothing here changes that cadence, only what the files will eventually contain.

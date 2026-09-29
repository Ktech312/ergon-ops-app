# Product Billing/SaaS — Consolidated Decisions Needed

Status: **design-only, produced 2026-09-27 at E's own explicit direction.** This document exists because
`PRODUCT_MASTER_COMPLETION_PLAN.md` (Phase 9, "Commercial SaaS readiness") carries a standing stop
boundary — *"Do not begin design work on this phase without an explicit go-ahead — standing
instruction, unchanged"* — and `PRODUCT_PLAN.md`'s own "Product account billing intentionally
deferred" section says the same. E's own instruction this session ("begin the final deferred area:
Billing/SaaS... produce one consolidated decision document") is that explicit go-ahead, so this
document does not violate either boundary — it fulfills the exact condition both were waiting for.

**No schema, no migration, no payment code has been written.** Every item below is a real decision only
E can make, each with a recommended default so a single pass of answers (not back-and-forth) can move
this into implementation. See `PRODUCT_BILLING_TECHNICAL_DESIGN.md` for the threat model, test plan, and
migration-sequencing work already done in parallel, built against these same recommended defaults as
working assumptions — corrected wherever E's actual answers differ.

## 0. What already exists (traced directly, not assumed)

- `workspaces.status` (migration 115) is `'active' | 'suspended'` only — a generic lockout switch, not
  billing-specific. `suspend_company()`/`reactivate_company()` (migration 198) already prove the pattern
  (platform-admin-gated, reason required, audited) but nothing distinguishes a billing-caused suspension
  from an admin-caused one today.
- Zero billing-adjacent columns exist anywhere (no plan tier, trial date, subscription status, or seat
  count on `workspaces` or any other table).
- Zero billing UI exists. Every "billing"/"payment" hit in `main.tsx` is a *customer's own* operational
  field (their SaaS contracts, PO payment notes, client billing addresses) — nothing about Ergon
  charging its own tenants. `PRODUCT_MARKETING_CLAIMS.md` already flags "SaaS subscription management"
  as **not true, do not claim** for exactly this reason.
- Three permission tiers exist: `is_workspace_admin` (one company's own affairs — the natural home for
  "who manages THIS company's billing"), `is_platform_admin` (Ergon-the-vendor's own cross-tenant
  administration — the natural home for "who administers billing FOR Ergon"), and the legacy global
  `is_app_admin`. No fourth, billing-specific permission concept exists.
- `api/` (17 serverless functions) has an established outbound-secret pattern (`api/_lib/mailer.js`
  reads `GMAIL_APP_PASSWORD`/`RESEND_API_KEY` from server-only env vars) but **no existing function
  receives an unauthenticated inbound webhook from a third party** — every current endpoint requires the
  app's own session auth first. A Stripe webhook handler would be the first of its kind here.
- `workspace_enabled_modules` (migration 218, shipped this session) already does per-workspace
  feature-gating — a real, working mechanism a plan-tier system could reuse rather than inventing a
  second one.

## 1. Business model

**Q1.1 — Pricing structure**: flat-rate per workspace, per-seat, usage-based/metered, or tiered plans?
**Recommended: tiered flat-rate plans** (e.g. Starter/Growth/Enterprise), each with a seat-count *soft
cap*, not true per-seat or usage billing. *Why*: no usage-tracking infrastructure exists yet (would be
new, unscoped work); flat tiers are simplest to reason about and implement first; seat caps alone give a
natural upgrade trigger without metering complexity.

**Q1.2 — What differs between tiers?** **Recommended: reuse `workspace_enabled_modules` (migration
218) as the tier-gating mechanism** — a plan tier is, mechanically, a default `workspace_enabled_modules`
row-set plus a seat cap, not a second, parallel feature-flag system. *Why*: this table already exists,
already enforces backend + nav + URL gating for Support/Engineering, and generalizing its backend
enforcement to the other ten modules was already flagged as a deliberate, scoped-out follow-up in
migration 218's own header — billing would be the real reason to finally do that follow-up.

**Q1.3 — Free trial**: length, and behavior at expiry? **Recommended: 14-day trial**, auto-started at
workspace creation/signup-approval, a warning banner in the final 3 days, then **read-only (not full
suspension)** at expiry until a card is added. *Why*: matches this codebase's own established
"preserve data, block writes, don't delete" pattern (module disable, workspace suspend) rather than a
harsher lockout; kinder to a genuine signup who just hasn't gotten to it yet.

**Q1.4 — Is Ergon's own workspace ever billed?** **Recommended: no — an explicit, enforced "internal/
comped" flag**, never silently "nobody happens to charge it." *Why*: must be a real, checked exemption
(a boolean or special plan value), not an assumption resting on nobody running the charge job against it.

## 2. Payment processor & architecture

**Q2.1 — Processor**: Stripe vs. building custom vs. another provider? **Recommended: Stripe.**
*Why*: industry standard, has Checkout/Billing/Tax/dunning built in — building any of that from scratch
is out of proportion to this product's current scale.

**Q2.2 — Checkout flow**: Stripe Checkout (hosted redirect) vs. Stripe Elements (embedded, in-app
card form)? **Recommended: Stripe Checkout.** *Why*: zero PCI scope (card data never touches Ergon's
own servers), fastest to ship, matches this app's own existing preference for hosted/managed flows over
custom ones (Google OAuth via Supabase Auth rather than a custom auth form).

**Q2.3 — Webhook handling**: a new `api/stripe-webhook.js` would be **the first unauthenticated-
inbound-webhook endpoint in this codebase** (every existing `api/*.js` requires the app's own session
auth first, confirmed by direct trace). This needs its own security posture, not the existing
`requireAuth.js` pattern: Stripe signature verification, event-id idempotency (Stripe retries
webhooks), and a clear code comment marking it as an intentionally different class of endpoint. Not a
question needing an answer — a design constraint flagged so nobody assumes the existing
`api/_lib/requireAuth.js` pattern applies here.

**Q2.4 — Secrets**: Stripe secret key + webhook signing secret as **server-only Vercel env vars**
(matching the existing `GMAIL_APP_PASSWORD`/`RESEND_API_KEY` pattern in `api/_lib/mailer.js`), never in
`src/persistence.ts`'s client-exposed `VITE_*` vars. A Stripe **publishable** key would only be needed as
a new `VITE_*` var if Stripe Elements is ever used — not needed at all under the Q2.2 recommendation
(pure Checkout redirect).

**Q2.5 — Test vs. live mode**: **Recommended: Stripe test-mode keys in preview/dev deployments, live
keys only in production Vercel env** — mirrors the existing dev/production Supabase env-var split
already in place.

## 3. Workspace lifecycle integration

**Q3.1 — Does a billing-caused suspension reuse `workspaces.status = 'suspended'`, or need its own
distinct state?** **Recommended: a new distinct status** (e.g. `'past_due'`), not reusing the existing
generic `'suspended'` value. *Why*: an admin-caused suspension and a payment-caused one need different
UI messaging and different recovery paths (an admin decision vs. "update your card") — collapsing them
into one enum value makes that distinction unrecoverable later. `company_admin_audit_log`'s own
`action` check constraint (`'suspended'|'reactivated'` only) would need widening, or (recommended
instead) a **separate billing-events audit table**, keeping the platform-admin's own manual-action audit
trail uncluttered by automated billing events.

**Q3.2 — Grace period before suspension on a failed payment?** **Recommended: Stripe's own default
smart-retry schedule (~3 attempts over ~2 weeks)**, then mark `past_due` with an in-app banner, then a
further **3-7 day grace window** before actually suspending. *Why*: avoids punishing a temporarily
expired card; matches typical SaaS dunning norms.

**Q3.3 — Does a billing-suspended workspace's data get deleted?** **Recommended: no — identical to
today's admin-suspend behavior** (data fully preserved, reactivates instantly on payment). *Why*:
matches this codebase's own explicit, repeated standing convention (migration 198's deliberate
non-action on hard deletion; the same "preserve, don't destroy" pattern this session's module-toggle
and onboarding-checklist work both followed).

**Q3.4 — Cancellation (user-initiated, not non-payment)**: immediate vs. end-of-current-period?
**Recommended: end-of-period** — standard SaaS practice, avoids clawback/refund complexity for the
unused remainder.

## 4. Access & permissions

**Q4.1 — Who manages a workspace's own billing (view invoices, change plan, update card)?**
**Recommended: `is_workspace_admin`** (the existing tier), not a new fourth permission concept.
*Why*: it's already scoped exactly to "this company's own affairs," and a company small enough to be
self-serve signing up doesn't need a separate billing-only role in v1. Flag a scoped "billing viewer"
role as possible *future* refinement if a real customer asks — not built now.

**Q4.2 — Who can see/override billing across ALL tenants (Ergon's own view)?**
**Recommended: `is_platform_admin` only** — matches its existing exclusive role as the one tier scoped
to "administers Ergon-the-vendor's own affairs across every tenant." The legacy global `is_app_admin`
should **not** get blanket billing visibility, consistent with this session's own established discipline
of never widening that flag's scope further than strictly necessary.

## 5. Data & compliance

**Q5.1 — Does Ergon ever store card data itself?** **Recommended: no.** Under the Q2.2 Stripe Checkout
recommendation, card data never touches Ergon's own servers or database at all (PCI scope: SAQ-A, the
lightest tier). Ergon would only store Stripe's own opaque IDs (customer id, subscription id, price id)
in a new `workspace_billing`-shaped table — not raw payment details.

**Q5.2 — Tax handling**: Stripe Tax (automatic calculation/remittance) vs. manual vs. deferred for v1?
**Recommended: defer for v1**, flagged as a fast-follow. *Why*: automatic tax requires nexus
registration/setup work orthogonal to getting basic subscription billing live; shouldn't block launch.

**Q5.3 — Invoicing**: Stripe's own hosted invoices vs. a custom-built invoice UI? **Recommended:
Stripe's hosted invoices/Customer Portal** — avoids building a redundant renderer for something Stripe
already provides well.

## 6. Currency & region

**Q6 — Multi-currency?** **Recommended: USD only for v1** — matches this product's current single-market
framing throughout `PRODUCT_PLAN.md` (US install/integration teams).

## 7. Seat overage

**Q7 — What happens when a company tries to add a teammate beyond their plan's seat cap?**
**Recommended: soft-block** — the invite flow requires an upgrade before completing the (N+1)th invite,
rather than silently allowing overage and metering it. *Why*: keeps v1 genuinely flat-rate (per Q1.1),
avoids building usage-based billing nobody asked for.

---

## 8. E's answer, 2026-09-29 — accepted with four corrections; foundation now shipped

E accepted every recommended default above except four, each now implemented in
`backend/supabase/migrations/221_billing_foundation.sql` exactly as corrected:

1. **Plan entitlement is separate from module preference (Q1.2 corrected).** Not "reuse
   `workspace_enabled_modules` as the gate" — instead, a new `plan_modules` table defines what a
   PLAN allows; effective access is `plan_allows_module() AND is_module_enabled()`, both true.
   An admin can never enable a module their plan excludes (enforced inside
   `set_workspace_module_enabled()` itself); changing plans never touches
   `workspace_enabled_modules` at all, so an upgrade never auto-enables something a workspace
   had deliberately turned off. `plan_modules` starts empty and every plan starts
   `modules_configured = false`, so this is a fully-built, fully-tested mechanism with zero
   actual restriction in effect yet.
2. **Billing status never touches `workspaces.status` (Q3.1 corrected).** `trialing`/`active`/
   `past_due`/`unpaid`/`canceled`/`comped` all live in the new `workspace_billing.status` column
   only — `workspaces.status`'s own existing `'active'`/`'suspended'` enum is completely
   untouched by migration 221.
3. **Exact payment-failure timing (Q3.2 corrected).** Not an assumed "~2 weeks" Stripe-retry
   duration — a workspace gets normal access for exactly 7 calendar days from the first
   `past_due` event (`workspace_billing.past_due_since`, set once per past_due episode, never
   reset by a repeat event), then goes read-only until payment is confirmed, restoring
   automatically. `unpaid`/`canceled` block outright; `is_comped = true` exempts a workspace from
   all of the above, unconditionally, including at the webhook-processing level.
4. **Duplicate-subscription prevention + webhook-only reconciliation (Q2.3/Q4 corrected).**
   `api/create-checkout-session.js` checks for an existing active/trialing/past_due subscription
   before ever creating a new Checkout session — redirects to the Billing Portal instead, per
   Stripe's own documented guidance. All state changes flow through exactly one path,
   `process_stripe_webhook_event()`, atomic (idempotency insert + state update in one function
   call) and never trusting a client-side success redirect.

**Still required before live checkout can ever be enabled — not guessed, not built** (E's own
list, verbatim): monthly price for Starter/Growth/Enterprise; whether annual billing is offered
and its discount; included modules per tier; seat soft cap per tier; whether the 14-day trial
requires a payment method; what plan a new trial receives (migration 221's `'starter'` default is
a structural placeholder, not a commercial commitment); whether upgrades take effect immediately
with proration; whether downgrades take effect at period end. None of these block the foundation
that's now shipped — every one is a plain data change (an `UPDATE` on `billing_plans`/
`plan_modules`, or a one-line default change) once answered, not a new migration.

**What's now built** (all 83/83 against the local consolidated isolation suite, run before ever
being sent to E): the full schema/RLS from §0's threat model, `is_module_available()`/
`plan_allows_module()`/`is_workspace_billing_blocked()`, the widened
`is_active_workspace_member()`/`resolve_caller_workspace_id()` chokepoints, auto-provisioning for
every new workspace, a safety backfill marking every currently-existing workspace (Ergon's own +
K-Tech) `comped` so nothing can be accidentally enforced against before commercial terms land,
`api/stripe-webhook.js` (signature verification + idempotent atomic processing),
`api/create-checkout-session.js` (with BOTH the `billing_settings.checkout_enabled` kill-switch
and the "no real Stripe Price ID configured" gate — either alone keeps production checkout
structurally impossible today), and `api/create-billing-portal-session.js`. See
`PRODUCT_BILLING_TECHNICAL_DESIGN.md` §5 and `HANDOFF.md`'s matching entry for full detail,
including the two real bugs this pass found (a wrong `is_platform_admin()` call signature, caught
by the local isolation suite before ever being sent) and the Vercel serverless-function-count
consequence of adding three new routes.

---

Status as of 2026-09-29: **answered and built, not pending** — see §8. Migration 221 is the next
single Supabase action; live checkout stays structurally disabled until the still-required
commercial values above are answered.

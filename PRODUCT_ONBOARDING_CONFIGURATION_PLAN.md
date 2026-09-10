# Product Onboarding & Configuration Plan

Status: **design-only, produced as part of an overnight autonomous work pass.** This is a NEW standalone document, not yet reconciled against the existing `PRODUCT_PLAN.md`/`PRODUCT_START_PLAN.md` — those weren't re-read in full during this pass, so this should be merged into them deliberately, not assumed compatible. SaaS subscription billing (plans/cards/seat billing for using Ergon itself) remains explicitly deferred, per standing product-plan decisions — nothing here proposes building it.

Goal: what does a brand-new company need to do, in order, to go from "just signed up" to "actually running their operations in Ergon"? This treats Ergon as a sellable, configurable product, not a single-customer internal tool — consistent with the standing product-readiness rule already in `HANDOFF.md`.

---

## 1. Workspace creation

The real `workspaces` table (migration 115) already exists and is live — this is the first genuine consumer beyond the one bootstrapped row. A new workspace needs: a creation flow (who can create one — likely a platform-admin-only action initially, not self-serve, until the isolation work in Phase 3 is proven), a `slug` chosen or generated, and a `status` starting at `active`.

**Hard dependency**: this cannot be built before Phase 3's real workspace-scoped RLS exists — creating a second workspace today would violate the authorization bridge's explicit safety invariant (Part 9.7.1, point 8 of the share-link decision document: the bridge is unsafe with more than one workspace). Onboarding a real second company is blocked on that work, not on this plan.

## 2. Business identity / branding

`company_branding` (migration 039) already exists as a singleton row — becomes workspace-scoped (`workspace_id` added) so each company sets its own name/logo. Straightforward schema change once workspace-scoping is otherwise safe to do.

## 3. Locations

Already has real infrastructure (project locations, site addresses). Onboarding needs a "add your first location" prompt, not new schema.

## 4. Users / invitations

Already real (`user_invites`, migrations 041/065). Onboarding needs a bulk-invite flow (invite several people at once with pre-set roles) rather than one-at-a-time, and — per the writer-audit work in progress — `accept_user_invite()` needs its bridge-aware counterpart (`bridge_accept_user_invite()`, designed in `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` Part 12.3) before this is safe to route through in a fully-narrowed-policy world.

## 5. Configurable roles / capabilities

Directly Stage 2 work (`PRODUCT_STAGE2_SCHEMA_PLAN.md`) — the `capabilities`/`workspace_role_capabilities` tables ARE the onboarding-time configuration surface: a new company gets the default capability-to-role mapping seeded, then can rearrange it without a code deploy.

## 6. Sales templates

`proposal_template_sections` (migration 053) is currently a single global table — needs `workspace_id` scoping so each company's boilerplate (payment terms, warranty language) is its own, seeded from a reasonable default set at workspace creation.

## 7. Notification rules

`notification_rules` (migration 024) — already per-event-type, needs workspace scoping the same way. Onboarding shows a sensible default rule set, editable immediately.

## 8. Link policies

Directly the share-link decision document's Part 2.1/9.1 item 6 — default expiration durations, seeded at workspace creation, editable in Settings → Document Links (Stage F of the implementation plan).

## 9. Numbering conventions

Quote refs (`SQ-2026-0001`-style), project refs — currently global sequences; would need per-workspace numbering once real multi-company use exists. Not urgent for a single-workspace world, but worth deciding the format question (per-workspace-reset vs. globally-unique) before it's ever needed, since changing a numbering scheme after real data exists is much harder than deciding it up front.

## 10. Required / optional modules

Not all customers will want every module (e.g., a company with no warehouse doesn't need Inventory). This needs a real "module toggle" concept — which tabs/features a workspace has enabled — layered on top of the existing role/tab-permission system, not replacing it. Design question, not yet resolved: does disabling a module hide it from everyone, or just stop offering it to new users? (Flagged as a decision needed, not answered here.)

## 11. Imports

A new company migrating from a spreadsheet or another system needs a bulk-import path for at minimum: catalog items, existing clients, existing quotes-in-flight. Not designed in this pass — flagged as real, necessary future work.

## 12. Guided checklist

A literal onboarding checklist screen ("Add your logo → Invite your team → Set up your first sales template → Configure notification rules → You're ready") — a thin UI layer over the above, no new backend beyond a `workspace_onboarding_progress` table tracking which steps are done.

## 13. Mobile readiness

Already a standing, enforced requirement for every new feature in this codebase (see `HANDOFF.md`'s mobile-table-rollout rules) — nothing new to design here beyond continuing to apply the existing discipline to every piece of the above as it's built.

## 14. Safe fictional demo data

For a prospective customer evaluating Ergon before committing real data — a workspace flagged `is_demo = true` (or similar) seeded with clearly-fictional company/client/project names, isolated the same way any other workspace would be once Phase 3 lands, and never mixed with the "safe to fill in fictional data for testability" allowance already established for the museum-builder-style DEMO_ITEMS pattern elsewhere in this codebase's sibling project (VLTD) — that precedent is about test fixtures, not a production demo-account feature, and shouldn't be conflated.

## 15. Support / service handoff

When a new customer needs help, who do they contact and how does that surface in-app? Not designed here — flagged as needing its own decision (a support-request flow, a documented external contact, or both).

## 16. Future Engineering/Development module

Referenced as a "future module" without further detail in the task brief — no existing code or product-plan precedent found for this in the current pass. Flagged as needing a scoping conversation with E before any design work begins; nothing invented here.

---

## What this plan deliberately leaves open

Every item above that says "flagged, not designed" is a genuine open question, not an oversight — this pass prioritized breadth (touching every item Task 9 named) over depth on any single one, consistent with an overnight autonomous pass producing first-draft material for morning review, not final specs.

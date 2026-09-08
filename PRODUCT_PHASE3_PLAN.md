# Phase 3 Plan — Threat Model and Test Matrix for Clients + Sales Quote RLS

Status: **SCOPING ONLY. No RLS policy has been written, changed, or proposed as runnable SQL. No
migration exists for Phase 3.** This document exists so that when Phase 3 (tightening RLS on the
Clients + Sales Quote cluster — `PRODUCT_TENANCY_AUDIT.md` §9's Phase 3) is actually scheduled,
the threat model, the required test matrix, and the "what must move together" analysis are already
done, evidence-based, and don't need to be re-derived from scratch under time pressure.

Built directly on Phase 2's evidence base (`PRODUCT_PHASE2_PLAN.md`, migrations 115-118, live and
verified in production as of 2026-09-08) rather than re-researching the schema. Every table/RPC/
function named here was directly confirmed to exist with the cited shape during Phase 1/2 work.

---

## 1. What Phase 2 already provides, and what Phase 3 must add

Phase 2 gave `clients` and `sales_quotes` a real, trigger-enforced, tamper-proof `workspace_id`
column (`PRODUCT_PHASE2_PLAN.md` §8.1). **It deliberately does not restrict who can read or write
any row** — RLS on both tables, and every inheriting child table, remains exactly
`using(true)/with check(true)`. Phase 3's job is to turn that now-reliable ownership metadata into
an actual access boundary: a user in workspace A must not be able to read, write, or otherwise
observe workspace B's clients, quotes, or any of their child records.

---

## 2. Threat model — cross-workspace access, by operation and table

| # | Threat | Table(s) | Today (Phase 2 complete, Phase 3 not started) | Required Phase 3 control |
|---|---|---|---|---|
| T1 | Cross-workspace SELECT | `clients`, `sales_quotes` | Fully open — any authenticated user reads every row in both tables regardless of `workspace_id` | RLS `select` policy scoped to `is_workspace_member(workspace_id)`, mirroring the pattern already proven safe in migration 115 for `workspace_members` itself |
| T2 | Cross-workspace INSERT | `clients`, `sales_quotes` | `workspace_id` is correctly and unspoofably stamped (Phase 2), but the row is still readable/writable by anyone once created | RLS `insert` `with check` should be redundant with the trigger (belt-and-suspenders) but must not conflict with it — the trigger fires first and stamps the real value; the RLS check should verify `is_workspace_member(workspace_id)` post-stamp, which is always true by construction, so this is a defense-in-depth check, not the primary guarantee |
| T3 | Cross-workspace UPDATE | `clients`, `sales_quotes` | Any field except `workspace_id` itself can be freely edited by any authenticated user, on any workspace's row | RLS `update` `using`/`with check` scoped to `is_workspace_member(workspace_id)` |
| T4 | Cross-workspace DELETE | `clients`, `sales_quotes` | Any authenticated user can delete any row in either table (cascade-deletes the entire child graph under a `sales_quotes` row) | RLS `delete` scoped to `is_workspace_member(workspace_id)` — **high blast radius**: an unauthorized cross-workspace delete today would cascade-remove every location, image, BOM line, intake response, and proposal under that quote |
| T5 | Child-row access inherited through parent | `sales_quote_locations`, `_location_images`, `_location_items`, `_bom_lines`, `_intake_responses`, `_proposals` | Fully open, same as parents — none of these tables has its own `workspace_id` (by design, §2.2 of the Phase 2 plan — they inherit ownership through the required FK) | RLS on each child table must join to its parent's `workspace_id` via an `exists (select 1 from sales_quotes q where q.id = <child>.quote_id and is_workspace_member(q.workspace_id))`-shaped policy (or the two-level version through `sales_quote_locations` for the location-item/image tables). **This is the one place Phase 3 must get exactly right** — a child table's policy checking the wrong parent, or checking `is_workspace_member` against the child's own nonexistent `workspace_id` column, is a silent no-op vulnerability, not a loud error |
| T6 | Public proposal token viewing | `public_share_tokens` + `sales_quote_proposals` (via `get_quote_proposal_by_token`) | `security definer` RPC bypasses RLS by nature (runs as owner) — token holder sees exactly one proposal's `content_snapshot`, cannot browse others (Phase 2 plan §3.3, corrected wording: this is intentional token-authorized access, not a leak) | No RLS change needed for the anon path itself (`security definer` always bypasses row-level policies), but the RPC should be updated to check the underlying quote's workspace `status = 'active'` before serving (see T8) |
| T7 | Public proposal responses | `respond_to_quote_proposal` RPC | Same `security definer` bypass; writes to `sales_quote_proposals` and directly to `notifications` with zero workspace awareness (Phase 2 plan §3.3) | Must gain the same suspended-workspace check as T6; `notifications` itself needs to become workspace-aware before RLS is ever added near it (see T9) — otherwise a legitimate customer response could silently fail to notify once RLS lands and this RPC hasn't been updated in step |
| T8 | Suspended-workspace public links | `get_quote_proposal_by_token`, `respond_to_quote_proposal` | Neither RPC checks `workspaces.status` today — a suspended workspace's public proposal links keep working forever | **Recorded as a required-before-Phase-3-is-complete item already in the Phase 2 plan** (§3.3) — both RPCs need a `join workspaces w on w.id = q.workspace_id where w.status = 'active'` guard added in the same phase that adds RLS, not left for later |
| T9 | Notification creation from proposal responses | `notifications`, `notification_rules` | `respond_to_quote_proposal` inserts directly into `notifications` with no workspace scoping at all — this is a pre-existing, already-documented gap (`PRODUCT_TENANCY_AUDIT.md`), not new to this analysis | `notifications` needs its own `workspace_id` (a separate table group's migration, likely its own mini-phase) before RLS can safely restrict who sees a notification — until then, RLS on `sales_quotes`/`clients` alone does not fully contain the workflow, since a notification about a workspace-A quote could theoretically be visible to a workspace-B admin if `notifications` itself is ever RLS-restricted incorrectly (or, today, isn't restricted at all) |
| T10 | Service-role and security-definer function access | `resolve_caller_workspace_id`, `guard_workspace_id_mutation`, `is_workspace_member`, `is_platform_admin`, etc. | All correctly `security definer` + `search_path=''`, with EXECUTE minimized (Phase 2's migration 118 closed the one grant gap found) | No change needed structurally, but every *new* Phase 3 policy function must follow the same audited pattern (revoke-then-grant only where demonstrably required, verified empirically as migration 117/118 did) — this threat model exists partly to make sure that discipline isn't relaxed under time pressure |
| T11 | Quote-to-project conversion | `createProjectFromClosedWonQuote()`, `projects.source_sales_quote_id` | Real, durable, `on delete set null` FK from `projects` back to the source quote — but `projects` itself has no `workspace_id` yet (Phase 2 plan §2.3, recorded forward dependency) | Once RLS restricts `sales_quotes` by workspace, this conversion function (which reads a `sales_quotes` row server-side) must run in a context that still has access to the source quote — either it needs to run as the same authenticated user (who, being a workspace member, will pass RLS normally) or, if ever moved server-side to an API route using the anon/service key, needs explicit workspace-aware handling. `projects.workspace_id` should land in the *same* phase that scopes the Projects table group, using this quote's `workspace_id` as the backfill source (already the plan, Phase 2 §2.3) |
| T12 | Legacy "Pull BOM from Closed Sales" | `handlePullBomFromClosedQuote()` / `pullQuoteId` | Confirmed, unfixed containment gap (Phase 2 plan §3.4): copies a quote's client name and BOM text into a project's local-state blob with **zero FK, zero traceable link** | **This is the single most dangerous unaddressed item for Phase 3.** Once RLS exists, this path could copy data from a workspace the acting user can still *see in this one dropdown* (since the dropdown's `<select>` of closed-won quotes isn't itself workspace-filtered until Phase 3 filters it) into a project with no audit trail connecting the two. Phase 3 must either (a) retire this path in favor of `createProjectFromClosedWonQuote()`, or (b) explicitly filter its quote dropdown by workspace membership as part of the same RLS rollout — leaving it unfiled while everything else gets scoped is not acceptable |
| T13 | Storage objects (sales-quote images) | `sales-quote-images` bucket | Bucket-wide policy only, not row-scoped to any per-object owner (Phase 1 audit finding, unchanged since) | Storage policy work is its own, larger later phase per the original roadmap (`PRODUCT_TENANCY_AUDIT.md` §9, Phase 5) — but Phase 3's RLS on `sales_quote_location_images` (the DB row) must not create a false sense of security: a workspace-B user who somehow learns a workspace-A image's storage path could still fetch the raw file directly from Storage, since DB-row RLS and Storage-bucket policy are two separate enforcement points. Recording this explicitly so Phase 3 isn't mistaken for "Storage is now safe too" |
| T14 | Global search / client-side cached results | `globalSearchMatches`, `globalSearchMatchesFull` (`main.tsx`) | Pure client-side filter over already-loaded `salesQuotes`/`clients` state (Phase 2 plan §3.5) — inherits whatever the *load* query returned, filters nothing further | Once the load query itself is RLS-scoped, search automatically inherits correct scoping for free — no separate search-specific fix needed, **but** this means until the load query is scoped, search is not a safe place to add a "coming soon" workspace filter UI, since the underlying data isn't scoped yet either |
| T15 | Platform-admin vs. workspace-admin access | `is_platform_admin()`, `is_workspace_admin()` | Both exist and are hardened (migration 115); `platform_admins` is empty in production | Any Phase 3 policy that needs a "can see everything, cross-workspace" escape hatch (e.g. for a future support/ops tool) must use `is_platform_admin()`, never a broader `using(true)` — and since `platform_admins` is empty today, that escape hatch is currently unreachable by anyone, which is the correct, safe default to preserve |
| T16 | Users belonging to multiple workspaces | `workspace_members` (unique per `(workspace_id, user_id)`, a user can have many rows) | Structurally possible today (the table allows it) but `resolve_caller_workspace_id()` (migration 117) explicitly **rejects** ambiguous multi-workspace writes rather than guessing (Phase 2 plan §4.1, confirmed decision §13: no user should get a second membership before an active-workspace selector exists) | RLS `select` policies are naturally fine with multi-membership (`is_workspace_member` returns true for any of the user's workspaces, so a multi-workspace user correctly sees the union of all their workspaces' data) — the real gap is exclusively on the *write* path, already closed by Phase 2's design. Phase 3 doesn't need to solve multi-membership RLS; it already works correctly by construction. The unsolved piece remains "primary workspace selection UI," which is a product feature, not an RLS problem |

---

## 3. Required denial tests before a second workspace can ever be created

Per the confirmed decision (`PRODUCT_PHASE2_PLAN.md` §13) that no second workspace exists until
Phase 3's isolation and an active-workspace selector are both built, these are the tests that must
**pass** before that decision is revisited — not aspirational, a hard gate:

1. **Cross-workspace SELECT denial**: authenticated user A (member of workspace 1 only) querying
   `clients`/`sales_quotes`/any child table must receive zero rows belonging to workspace 2, not a
   permission error and not a silently-filtered-to-empty result that looks identical to "no data."
2. **Cross-workspace INSERT denial for children**: user A must not be able to insert a
   `sales_quote_locations`/`_bom_lines`/etc. row whose `quote_id` points at a workspace-2 quote,
   even if they somehow know that quote's UUID (e.g. from a stale bookmark or a leaked ref number).
3. **Cross-workspace UPDATE/DELETE denial**: user A attempting to update or delete a workspace-2
   `clients`/`sales_quotes` row (again, by guessed or leaked UUID) must fail via RLS, not succeed
   silently.
4. **Public token isolation**: a proposal share token issued for a workspace-1 quote must not
   resolve any workspace-2 data even under adversarial input (malformed tokens, token reuse
   attempts) — this is already partially true by construction (§2, T6) but must be re-verified
   once RLS exists, since a future refactor of `get_quote_proposal_by_token` could accidentally
   introduce a join that RLS would otherwise have caught.
5. **Suspended-workspace denial**: once workspace `status = 'suspended'` is enforced (T8), every
   write path — including the public RPCs — must reject that workspace's activity, and this must
   be tested with a real suspended throwaway workspace, not just code-read.
6. **Platform-admin escape-hatch test**: confirm `is_platform_admin()` correctly grants
   cross-workspace access when true and correctly denies it when false (`platform_admins` empty),
   using the same fixed-known-UUID pattern Phase 1's Test B correction established — not a query
   that could itself be silently filtered by the RLS under test.
7. **Multi-workspace read correctness**: a user with real memberships in two workspaces sees the
   union of both, not just one and not neither — this protects against an overly narrow policy
   that accidentally scopes to `= workspace_id` instead of `is_workspace_member(workspace_id)`.

None of these can be executed today (§3 of `PRODUCT_PHASE2_PLAN.md`'s §11.4 already states this
plainly) — they're recorded here, in full, so Phase 3's own plan document can adopt them directly
rather than re-deriving the list under time pressure.

---

## 4. Minimum table group Phase 3 must secure together

**Partial RLS is worse than no RLS** for this cluster, because a rep's normal workflow spans the
whole graph in one sitting (create quote → add locations → add BOM → send proposal). If RLS lands
on `sales_quotes` but not on `sales_quote_locations`, for example, a legitimate same-workspace
insert into `sales_quote_locations` could still succeed (its own RLS is unrestricted), but a
correctly-scoped `select` on the freshly-created `sales_quotes` row could behave inconsistently
depending on exactly which policy shape was chosen for the parent — worse, an *incorrectly*
scoped child policy is the single highest-risk failure mode in this whole cluster (§2, T5).

**The minimum atomic group for one RLS migration:**
- `clients`
- `sales_quotes`
- `sales_quote_locations`
- `sales_quote_location_images`
- `sales_quote_location_items`
- `sales_quote_bom_lines`
- `sales_quote_intake_responses`
- `sales_quote_proposals`

All eight, in one migration, one transaction, tested together — not staggered across multiple
releases. `proposal_template_sections` and `public_share_tokens` are **not** part of this group
(confirmed structurally out of the ownership graph, Phase 2 plan §2.2) and should not be RLS-
restricted by workspace at all — the former is intentionally shared/global, the latter is shared
infrastructure with Submittals. `notifications` is explicitly **excluded** from this group too,
despite being written to by `respond_to_quote_proposal` — it needs its own `workspace_id` and its
own phase (T9) before it can be safely RLS-restricted; bundling it into this migration would
either delay Phase 3 waiting on unrelated Notifications-table design work, or ship it half-done.

**Why "test together, ship together" matters here specifically**: the eight-table group shares one
practical property — every one of them is reachable, in normal use, from a single quote detail
page in one session. A tester (or a real rep) exercising that page after a partial RLS rollout
would hit a confusing, inconsistent mix of "this part is scoped, this part isn't" that's much
harder to diagnose than either "nothing is scoped yet" or "everything is scoped correctly."

---

*Prepared as Phase 3 scoping only. No RLS policy has been written or proposed as runnable SQL. No
migration exists for this phase. This document is intended to be the starting point for Phase 3's
own implementation plan, not a substitute for one — a real Phase 3 plan still needs the same
multi-round review rigor Phase 1 and Phase 2 went through before any migration is created.*

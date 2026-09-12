# New-Company Onboarding & Administrator-Configuration Design

**Scope**: Product design only, per Priority 7 of the 2026-09-08 overnight work queue. No source
files, migrations, or data were modified to produce this report. This document extends
`PRODUCT_TENANCY_AUDIT.md` (its §5 no-code inventory, §7 preview/versioning findings, §10 working
decisions — especially #6 on starter templates and #12 on the propose/review/approve pattern) and
`PRODUCT_PLAN.md`'s "Company and workspace separation" / "Guided setup and onboarding" / "No-code
business configuration" sections, rather than re-deriving their findings.

**Material fact folded in that postdates the audit document**: Phase 2 has run and been verified
in production since the audit and `PRODUCT_PHASE1_PLAN.md` were written — migrations
`117_clients_sales_quote_workspace_ownership.sql` and
`118_revoke_workspace_ownership_function_grants.sql` gave `clients` and `sales_quotes` a real,
trigger-enforced, `NOT NULL` `workspace_id` column, backfilled to the Ergon Test Workspace
(`PRODUCT_PHASE2_PLAN.md`, Revision 5, both migrations run and verified). This matters directly
for §8 and §9 below.

---

## 1. Inventory: administrator-configurable today vs. still hard-coded

### 1a. Confirmed no-code configuration surfaces (Admin page, `#admin`, gated by `isAdmin`/`isManagerRole`)

| Panel | Admin can change, no code | Evidence | Still fixed underneath |
|---|---|---|---|
| Company Branding | Company name, logo | `main.tsx:17273` | Pre-auth screens hard-code `/ergon-logo.png`/"Ergon" (`main.tsx:6774,6804,6828,6848`); default React state is `{ companyName: "Ergon", ... }` (`main.tsx:1256`) |
| Pending Approvals | Approve/deny/expire sign-ins, assign role+expiry | `main.tsx:17296` | Fixed role list (`ROLE_KEY_OPTIONS`) |
| Team Roster | Invite by email, assign primary + secondary role(s) | `main.tsx:17334` | Fixed role list |
| Notification Rules | Toggle channel + active flag, per event type | `main.tsx:17580` | Event-type catalog fixed server-side (`api/_lib/notificationEvents.js`); `notification_rules.event_type` still database-wide `unique`, not `(workspace_id, event_type)` |
| Standard Install Times | Free-text category, hours/unit, notes | `main.tsx:17613` | None found — genuinely open-ended |
| Project Schedule Templates | Create templates, add/remove/reorder phases, duration rules, optional default role | `main.tsx:17640` | Default-role dropdown limited to fixed role list |
| Form Builder (After-Sales Handover, Site Intake) | Add/edit/reorder/delete arbitrary fields on two DB-backed schemas | `main.tsx:17716,17728`; `form_schemas`/`form_schema_fields`/`form_schema_field_options` (`026_phase18_fluid_forms_handover.sql:12,24,43`) | None found — genuinely no-code and generic |
| Pre-Sales Rules | Map catalog category + node count + cloud-sync flag → baseline hardware qty | `main.tsx:17740` | Category options drawn from fixed `CATALOG_CATEGORY_OPTIONS` |
| Site Hardware Rules | Item name, qty/unit, notes, active flag, per metric | `main.tsx:17810` | Metric types (`SITE_HARDWARE_METRIC_OPTIONS`) are fixed |
| Proposal Template | Edit each section's boilerplate text | `main.tsx:17871` | Ships pre-loaded with one company's real legal text (`053_sales_quote_proposals.sql:60-96`) |
| Catalog Price Change Requests | Approve/reject proposed catalog price edits | migration `046` | The reference propose/review/approve pattern (see §4) |
| Admin role/tab/admin-rights grid | Per-user primary+secondary role, exact tab override, grant/revoke admin, approval status | `PRODUCT_TENANCY_AUDIT.md` §5 | Role list and `ALL_TABS` (`main.tsx:479`) both fixed; only the per-user *assignment* is dynamic |

This is a real, substantive no-code foundation. Nothing in tonight's Phase 1/Phase 2 database
work touched any of these panels' behavior.

### 1b. Newly confirmed hard-coded items, with tonight's fixes folded in

| Item | Status | Evidence |
|---|---|---|
| Dead client-data array | **Fixed tonight** — deleted from `main.tsx`. | `HANDOFF.md`'s 2026-09-08 work-log entry, commit `af8e1b0` |
| `emeraldQueenImportedProject` fallback | **Fixed tonight**, plus a *second, previously unflagged instance* found and fixed in the same pass — `api/sales-quote-extract.js`'s live `extractQuoteData()` had an `isEmeraldQueen` special case (hardcoded real client identity + artificially inflated confidence) — **removed entirely**. | Same HANDOFF entry |
| Vertical-specific taxonomy | `CATALOG_CATEGORY_OPTIONS` (10 fixed categories incl. literal "EnSight Kits"), `CATALOG_CATEGORY_FIELDS`, `SITE_HARDWARE_METRIC_OPTIONS` | `main.tsx:18446-18461,18501-18547,19360` |
| Fixed role vocabulary | `ROLE_KEY_OPTIONS` in the frontend, and `workspace_member_roles.role_key`'s check constraint in the database — **explicitly documented in the migration as a transitional limitation** requiring workspace-configurability "before a second company can define its own role vocabulary" | `115_workspaces_foundation.sql:55-69` |
| Default BOM ship-to | `DEFAULT_BOM_SHIP_TO = "EnSight Office"` | `main.tsx:468` |
| Global nav/tab structure | `ALL_TABS`, `TAB_LABELS`, `DEFAULT_TABS_BY_ROLE`, `ROLE_QUICK_ACTION` | `main.tsx:479,489-506,515-526,533-549` |
| Company branding singleton default | `company_branding.company_name` defaults to literal `'Ergon'` in both the column default and the seed insert | `039_company_branding.sql:8,15-16` |
| Pre-auth screen branding | Hard-coded `/ergon-logo.png`, `alt="Ergon"` at 4 separate render sites, rendered before any workspace can resolve | `main.tsx:6774,6804,6828,6848` |
| **Workspace/platform-admin split exists in the DB but not in the frontend yet** | `workspace_members.is_workspace_admin`/`platform_admins` (migration 115) exist with RLS, but a repo-wide search for `is_platform_admin`/`Platform Admin`/`Tab Access`/`Grant Admin` in `main.tsx` returns **zero matches** — the Admin grid still gates purely on the pre-workspace `isAdmin` boolean sourced from the old global `app_admins`/`is_app_admin()` check | `main.tsx:1251,2622` |

**New finding worth flagging on its own**: the database-level workspace/platform-admin split
(Phase 1) and the ownership columns on `clients`/`sales_quotes` (Phase 2) are both live and
correct, but **zero frontend or API code reads or writes any of it yet**. Every admin action
today, even on the freshly-migrated database, still flows entirely through the pre-workspace
path. Consistent with the staged migration's own design intent (zero behavior change through
Phase 1/2), but it means every screen in the onboarding flow below is genuinely new — none of it
extends an existing UI.

---

## 2. New-company onboarding flow (design only)

Follows `PRODUCT_PLAN.md`'s 10-step "Guided setup and onboarding" list, made concrete against
what actually exists per §1. Per the audit's own staging, this is explicitly the **last** phase,
after isolation is proven — nothing here proposes building it before then.

1. **Create the company workspace** — platform-admin-only (no self-serve signup surface in scope;
   product-account billing is explicitly deferred everywhere). Choice of starter configuration
   (§7) happens here.
2. **Company identity, addresses, contact info, timezone, regional settings** — all new fields;
   `company_branding` today only has `company_name`/`logo_storage_path`. Timezone matters
   immediately for task due dates, Schedule Template phase durations, and the `task-overdue` cron.
3. **Branding** — reuses the existing panel's shape but must move from the singleton
   `company_branding` table to a per-workspace row (audit's Phase 4). Must also finally reach the
   4 pre-auth hard-coded render sites — today even a fully-configured second workspace's users
   would see "Ergon" branding on sign-in, since pre-auth screens render before any workspace can
   resolve. Genuine open design question: a workspace-aware pre-auth route, or accept platform
   branding pre-auth and company branding only post-auth.
4. **Invite team members and assign responsibilities** — the invite system's technical pattern
   is reusable but entirely unscoped today: `user_invites` has no `workspace_id`,
   `createInvite`/`loadInvites`/`fetchInviteByToken`/`acceptInvite` take no workspace parameter,
   and `accept_invite` grants roles against the global `app_user_roles`, not
   `workspace_member_roles`. Needs the same nullable→backfilled→NOT NULL pattern Phase 2 just
   proved out, applied to `user_invites`.
5. **Choose enabled modules and navigation** — see §5.
6. **Review/modify workflow stages, statuses, approvals, required fields** — `TASK_STATUS_OPTIONS`,
   `PURCHASE_ORDER_STATUSES`, `TASK_PRIORITY_OPTIONS` are all fixed unions with zero admin surface
   today. This onboarding step currently has nothing to configure.
7. **Import or create clients, contacts, products, services, pricing, equipment bundles** —
   "create" already works for most of these; "import" doesn't exist for any entity (§9). Contact
   and Opportunity don't exist as tables at all yet — blocked on schema work, not just UI.
8. **Select/customize quote, email, document, project, schedule templates** — Schedule Templates
   and Proposal Template Sections are reusable once workspace-scoped; outbound email bodies
   (`api/_lib/mailer.js` and the 5 send-*.js routes) are fully hard-coded server-side, not
   admin-editable at all — a real gap.
9. **Configure notifications, business hours, escalation rules** — Notification Rules panel is
   reusable once composite-keyed; business hours/escalation don't exist in any form.
10. **Run a sample workflow and complete a launch-readiness checklist**:
    - [ ] Workspace created, slug unique, status `active`
    - [ ] At least one `workspace_members` row with `is_workspace_admin = true`
    - [ ] Company name/logo set (not left at platform default)
    - [ ] Timezone and regional settings set
    - [ ] At least one team member invited and accepted
    - [ ] Enabled-modules/navigation set explicitly
    - [ ] Starter catalog reviewed (prevents an unreviewed vertical-specific catalog reaching a general-business workspace)
    - [ ] At least one Schedule Template and one Proposal Template section reviewed
    - [ ] Notification Rules reviewed
    - [ ] Sample workflow completed: one client → one quote → convert to one project → generate one schedule → complete one task, entirely inside the new workspace, with confirmation none of it is visible from the Ergon Test Workspace

    Implies a `workspace_onboarding_state` table tracking per-step completion — new, additive,
    low risk.

---

## 3. Configuration responsibility matrix

| Configurable item | Workspace admin | Manager | Ordinary user (role-specific) | Platform admin | Requires a programmer |
|---|:---:|:---:|:---:|:---:|:---:|
| Company name/logo/branding | Yes | | | Yes (any workspace, support) | Pre-auth screen branding |
| Timezone/regional settings | Yes | | | | New feature — build first |
| Team invitations | Yes | | | Yes | — |
| Role assignment (existing vocabulary) | Yes | | | Yes | — |
| New role vocabulary (add/rename/remove) | — (see §6) | | | | Yes today; §6 proposes making this workspace-editable later, with approval gate |
| Module/nav enablement | Yes (proposed, §5) | | | Yes | Currently fully hard-coded |
| Product/service catalog | Yes, or delegated | Yes | Price *changes*: propose only, manager/admin approve | Yes | New catalog categories/spec fields |
| Quote/proposal templates | Yes | | | Yes | — |
| Project/schedule templates | Yes | Yes (`pm`) | | Yes | — |
| Forms | Yes | | | Yes | New form types beyond the two seeded |
| Notification rules | Yes | | | Yes | New event types |
| Task/PO statuses, priorities | — | | | | Yes today, no admin surface at all |
| External integration credentials | Slack/Teams only (per confirmed decision) | | | Email/push defaults; paid AI gated behind future billing | Provisioning underlying accounts |
| Outbound-link allow-list | — | | | | Yes today (`api/_lib/validateUrl.js` hard-coded array) |
| Workspace suspension/deletion | — | | | Yes only | — |
| `is_workspace_admin`/`is_platform_admin` flags | Grant/revoke workspace-admin within own workspace (already the RLS shape) | | | Grant/revoke platform-admin only | These two must never become admin-editable business configuration — see §6 |

---

## 4. Preview / version history / audit trail / rollback / protected approval needs

Building on the confirmed "freeze-at-creation-time" pattern (Proposal Template and Schedule
Template edits do not retroactively affect already-sent proposals/already-generated schedules).

| Setting | Preview? | Version history? | Audit trail? | Protected approval? | Reasoning |
|---|:---:|:---:|:---:|:---:|:---:|
| Company branding | Yes | Yes — no rollback exists today | Nice-to-have | No | Low-stakes but zero history currently |
| Proposal Template sections | Yes | Already safe by design (freeze-at-send) | Recommended | No, given the freeze | Model to copy elsewhere |
| Schedule Templates | Yes | Already safe by design | Same | No | Same |
| Notification Rules | No | Not really needed | Gap: no `changed_by` confirmed | No | Low individual risk; matters more with multiple workspace admins |
| **New role vocabulary changes** | Yes | Yes | Yes | **Yes — reuse propose/review/approve** | Removing/renaming a role can silently strand users whose `workspace_member_roles` row references it |
| Module/nav enablement | Yes | Yes | Yes | Recommended | A preview ("3 users currently use the tab you're disabling") avoids surprise breakage |
| Catalog category/taxonomy edits | Yes | Yes | Yes | **Yes, reuse Catalog Price Change Requests' pattern** | Renames/removals affect every existing catalog item and every sent proposal that referenced the category by name |
| Product Catalog prices | N/A (solved) | N/A | Already exists | **Already exists** | Reference implementation |
| Team member role/tab/admin-rights changes | No | Recommended | Open verification item, not independently confirmed | No | Carrying this open item forward unchanged |
| Workspace-level settings generally | Case-by-case | Case-by-case | Yes, uniformly | Only for settings affecting customer-facing output or financial/permission boundaries | Restates `PRODUCT_PLAN.md`'s own requirement, applied item-by-item |

---

## 5. Module enablement and navigation configuration (design, not implemented)

**What already exists to generalize from**: `DEFAULT_TABS_BY_ROLE` (`main.tsx:515-526`) is
exactly the role-to-view mapping to generalize. `ALL_TABS` (`main.tsx:479`) is the fixed universe
of 12 tabs. The runtime resolution (`main.tsx:6865-6874`) already has the right three-tier shape —
admin sees everything, a per-user override wins if set, otherwise the role default — missing only
the workspace layer.

**Proposed generalization**:
1. `workspace_enabled_modules(workspace_id, view_key, enabled)` — a workspace that hasn't enabled
   `client_ledger`/`saas_calendar` never shows it, for any role, any user.
2. `workspace_role_default_tabs(workspace_id, role_key, view_key)` — replaces the fixed-in-code
   half of `DEFAULT_TABS_BY_ROLE`, seeded per starter configuration at creation, admin-editable
   after.
3. Resolution becomes 4-tier: `allowedTabs = isAdmin ? enabledModulesForWorkspace : (perUserOverride ?? workspaceRoleDefaultTabs ?? nothing)` — the workspace's enabled-module list becomes a hard
   ceiling even a stale per-user override can't cross.
4. The existing per-user override mechanism is preserved as-is.
5. Onboarding step 5 becomes: admin checks/unchecks entries from `ALL_TABS` into
   `workspace_enabled_modules`, then optionally adjusts each role's default subset.

**What stays fixed, deliberately**: `ALL_TABS` itself (the universe of possible modules) should
not become admin-editable — adding a genuinely new module is product development, not
configuration. Enabling/disabling among the fixed universe is configuration; inventing a new tab
is not.

---

## 6. Configurable role definitions (design), preserving protected system permissions

**Hard constraint, reaffirmed**: `is_platform_admin`/`is_workspace_admin` must remain
structural/hard-coded, never admin-editable — they're the authorization primitives RLS policies
and security-definer functions trust directly. This report does **not** propose changing
`workspace_member_roles`' table schema — forward-looking design only, for a later phase.

**Proposed shape (future, not this phase)**:
- Keep `workspace_members.is_workspace_admin` and `platform_admins` exactly as migration 115
  built them — untouched, permanent, schema-level.
- Replace `workspace_member_roles.role_key`'s global check constraint (already flagged in the
  migration's own comment as needing this) with a FK to a new
  `workspace_role_definitions(workspace_id, role_key, label, ...)` table, seeded from today's 10
  values as the default, editable per workspace thereafter — never a hard delete if any
  `workspace_member_roles` row still references it (mirrors the site-wide soft-delete standard).
- **Operational roles are business configuration**; `is_workspace_admin`/`is_platform_admin` are
  not roles in this table at all — the load-bearing distinction: "role" = what work you do
  (configurable), "admin flag" = what trust boundary you sit inside (never configurable by the
  boundary's own members).
- A rename must cascade everywhere the role label is displayed without breaking any `role_key`
  used as a literal string match in default-tabs/quick-action lookups — those lookup tables need
  to become workspace-scoped too (§5) for a renamed/added role to get sensible defaults.

---

## 7. Three starter configurations

Per the confirmed working decision: ship an Ergon/parking starter and a clean general-business
starter, with controlled administrator configuration rather than unrestricted free text. This
section adds the third (fictional public-demo) starter and makes all three concrete.

| Dimension | Starter A — Ergon/Parking (today's default) | Starter B — Clean general-business | Starter C — Fictional public-demo |
|---|---|---|---|
| Company name/logo | "Ergon"/current logo | Blank / placeholder | A clearly fictional name chosen specifically not to collide with any real company — learning directly from tonight's fix, where the old Emerald Queen fallback used a real casino's real name |
| Catalog categories | Current 10 incl. literal "EnSight Kits" | Generic: Products/Services/Bundles/Uncategorized | Same shape as A, fictionalized labels only where they'd leak a real product-line name |
| Category spec fields | Current VPU/Camera/Signage/etc. | Minimal generic free-text | Same as A, fictionalized only where needed |
| Site hardware metrics | FLI/LPR/people-counting | Module disabled (meaningless outside the vertical) | Same as A — the demo should show the real product |
| Default BOM ship-to | "EnSight Office" | Blank/workspace default | A fictional site name |
| Proposal Template sections | Current EnSight legal boilerplate | Generic placeholder, marked "replace before sending" | Fictional-but-realistic boilerplate, no real EnSight contract language |
| Sample data | None needed — this is the real workspace | None — starts empty | **Required, required fictional** — generated fresh, never copied or derived from the Ergon Test Workspace's real rows |
| Enabled modules | All 12 | Configurable, likely excludes `client_ledger`/`saas_calendar` unless applicable | All 12 — demo showcases full functionality |
| Role vocabulary | Current 10, as-is | Same 10 as a default, editable from day one | Current 10, unedited |

---

## 8. Public demo workspace isolation from the Ergon Test Workspace

Connects directly to the already-recorded requirement (`HANDOFF.md`'s migration-116 entry): the
Ergon Test Workspace holds real operational data and must never be used as a public demo; a
future demo requires a wholly separate, isolated workspace with fictional data. This section
specifies what "isolated" concretely requires given what's actually built as of tonight.

**Current state relevant to isolation**: `clients` and `sales_quotes` now have real, `NOT NULL`,
trigger-enforced `workspace_id` — a demo workspace's clients/quotes would, by construction, get a
different `workspace_id`. **But RLS on both tables is explicitly untouched by migration 117** —
its own header comment states this directly: this migration adds tamper-proof ownership
*metadata*, not cross-workspace access *containment*; that's Phase 3's job
(`PRODUCT_PHASE3_PLAN.md`). So today, even with a correctly-tagged second workspace, any
authenticated user from either workspace could still read/write the other's `clients`/
`sales_quotes` rows. Every other shared-record table (`projects`, `product_catalog`, `tasks`,
`project_documents`, storage buckets) has no `workspace_id` at all yet.

**What this means concretely**: a public demo workspace must not be created for real use before
RLS containment is in place for at least the tables a demo exercises. Creating one today — even
with perfect fictional seed data and correct tagging on the two Phase-2 tables — would not
prevent a demo visitor's session from reading real Ergon Test Workspace `clients`/`projects`/
`product_catalog`/`tasks` rows, because RLS still says `using (true)` on all of them.

**Sequencing**:
1. Design/author demo seed content now (pure content authoring, no schema risk) — but do not load
   it into any real table yet.
2. Extend the Phase 2 `workspace_id` pattern to every table a demo would touch (`projects`,
   `product_catalog`, `equipment_types`, `tasks`, `project_documents`, storage buckets).
3. Tighten RLS for each of those tables (Phase 3), verified against the same bar migration
   117/118 already met.
4. Only then create the demo workspace, seed it with the fictional content from step 1, and grant
   demo-visitor accounts membership in *only* that workspace.
5. Storage isolation: a demo workspace's uploaded files must land under a demo-specific path
   prefix with enforcing policies — otherwise a demo visitor could browse real files by bucket
   alone (still an open finding on 8 of 9 buckets).
6. Demo accounts should never be platform admins, and `is_workspace_admin` should be limited to
   the demo workspace only — migration 115's RLS already scopes `workspace_members`/
   `platform_admins` reads correctly for this, a genuine bright spot ahead of the rest.

**What must never happen, restated concretely**: never derive demo seed data by copying rows out
of the Ergon Test Workspace's real tables — author it fresh, the same way tonight's fix replaced
`emeraldQueenImportedProject`'s real casino data with fictional content of the same *shape* rather
than a scrubbed copy of the real thing. Never reuse a real client/project name as a "fictional"
placeholder even for demo purposes — the exact failure mode tonight's fix corrected
(`api/sales-quote-extract.js`'s `isEmeraldQueen` case) is the cautionary example for why fictional
content needs to be genuinely invented, not lightly disguised real content.

---

## 9. Import requirements (design/requirements only — no import performed)

**General requirements**: CSV upload for flat entities (matches the existing Sales Catalog bulk
import pattern, `main.tsx:18557`, worth generalizing rather than reinventing per entity); every
imported row must be created under the importer's own resolved `workspace_id`; a preview/row-count/
field-mapping step before commit; an explicit decision on all-or-nothing vs. partial-success
handling.

**A real, already-built safety net**: for `clients` and `sales_quotes` specifically, an import
*cannot* accidentally or maliciously write into another workspace, even before any import UI
exists — `guard_workspace_id_mutation()` (migration 117) overwrites whatever `workspace_id` an
INSERT supplies with the caller's own server-resolved value. Other entity types have no
equivalent trigger yet and need one built alongside their own `workspace_id` migration before
import is safe.

**Clients**: name (required, collides with the existing global-unique constraint, which becomes
`unique(workspace_id, name)`), contact, address, notes. Dedup on `(workspace_id, name)`
case-insensitive, surfaced for review rather than silently merged.

**Contacts**: blocked — no dedicated table exists yet; import requirements can't be finalized
until the table itself is designed.

**Products**: catalog number, name, category (must match a workspace-configured category), sell
price, cost, manufacturer, tags. Dedup on `(workspace_id, catalog_number)` — currently globally
unique, needs the same composite-key conversion `clients.name` needs. Needs true partial-success
reporting given likely bulk scale (hundreds of SKUs).

**Users**: not a raw data import — importing a "user" means importing an invitation or a role
assignment, never a password or an `auth.users` row directly. Must go through the existing
`createInvite`/`accept_invite` flow, not a direct `workspace_members` insert, preserving the
"invite requires acceptance" security property. `team_members(lower(email))`'s current global
uniqueness is exactly the collision an import routine would hit first — needs the composite-key
conversion before bulk import is safe to build.

**Templates**: structured, nested data (phases/sections/fields) — a JSON export/import pattern
fits better than flat CSV, and is the natural mechanism for seeding a new workspace from one of
the three starter configurations (§7). No current uniqueness constraint on template names, so
lower risk on that dimension, but still needs an explicit duplicate-name decision.

---

*Prepared as Priority 7 discovery/design work, 2026-09-08. No source file was edited to produce
this report. The single most consequential new finding: the workspace/platform-admin split and
the two ownership-tagged tables that already exist in the database are not yet reachable from any
frontend or API code — every admin action today still runs entirely through the pre-workspace
path, so the onboarding flow, role-configuration design, and module-enablement design here all
describe genuinely new UI, not an extension of anything partially built already.*

---

## Task 10 Product-Readiness Review (overnight autonomous pass, 2026-09-11)

**Verification status (added 2026-09-11, review): this entire section was produced by a delegated
background agent, not read and verified line-by-line by the orchestrating session.** The
orchestrating session independently spot-verified exactly ONE material current-state claim from
this section against source directly: "inventory categories are a separate hardcoded 6-option
`<select>` with no DB CHECK constraint" — confirmed at `src/main.tsx:10975` (the literal hardcoded
`<option>` list: Base, Communications, Power, Lighting, Display, Build) and against
`backend/supabase/migrations/001_initial_ops_schema.sql:82` (`category text,` — no CHECK
constraint) plus a repo-wide grep across every migration finding no later constraint added on this
column. No other claim below has been independently re-checked by a second reader. Treat every
**current-state** claim below as a **preliminary, agent-sourced finding** pending its own
spot-check before it's relied on for a real product decision — not as a fully double-checked code
audit. The **recommendations and configuration-boundary conclusions** remain valid product thinking
regardless of whether every underlying citation is re-verified. The agent's own stated scope/method
follows below, unedited.

**Scope note**: this section extends the inventory above with a specific focus — the configuration
surface a workspace admin should eventually control — checked directly against today's code
(`src/main.tsx`, `src/persistence.ts`, `backend/supabase/migrations/*.sql`), not re-derived from
`PRODUCT_TENANCY_AUDIT.md`'s findings. Billing/payment collection is out of scope, as is any actual
tenancy/second-workspace work — read-only, design-only, per the same rules as the rest of this
document. Line numbers below are current as of this pass; several have drifted from earlier
sections above (the file has been edited since 2026-09-08). Where a finding simply confirms
something already covered in full above, it says so rather than repeating the analysis.

### 1. Business name and branding — Partial

- **Current state**: `company_branding` (migration `039_company_branding.sql:7-16`) is a singleton
  row with `company_name`/`logo_storage_path`; Admin > Company Branding (`main.tsx:17173`, labeled
  "change these to reuse this app for a different company") lets today's admin edit both, and the
  main post-auth top-nav brand mark correctly reads the live value with a sane fallback
  (`main.tsx:6801`: `branding.logoStoragePath ? companyLogoUrl(...) : "/ergon-icon.png"`, alt text
  bound to `branding.companyName`). That part genuinely works, no code change needed.
- Still hardcoded, found this pass: the default React state initializes to the literal `"Ergon"`
  (`main.tsx:1145`); four separate pre-auth screens (sign-in, reset, pending-approval variants)
  hardcode `src="/ergon-logo.png" alt="Ergon"` (`main.tsx:6674,6704,6728,6748`); the PWA install
  banner icon is hardcoded (`main.tsx:7797`); and — a new, more granular finding than previously
  documented — the first-login **welcome slideshow** is *half*-fixed: its `alt` text correctly
  reads the live `companyName` variable, but its `src` is still the literal `"/ergon-logo.png"`
  file path (`main.tsx:16886`), so a renamed/re-logo'd company still sees the old logo image on
  this one screen even though the alt text now says the new name.
- **Gap**: a second company cannot get its own `company_branding` row at all (singleton `check (id)`
  constraint, unchanged from `PRODUCT_TENANCY_AUDIT.md` §1); and even for today's single real
  company, roughly six render sites never reflect a changed name/logo.
- **Recommendation**: two different sizes of work. (a) A **small, low-risk UI fix**, buildable today
  with zero tenancy dependency: wire the welcome-slideshow `src`, the default React state, and the
  install-banner icon to the existing `branding` state the same way the top-nav mark already does —
  this doesn't touch the pre-auth screens' harder problem. (b) Converting the singleton to a
  per-workspace row is the schema/architecture change already scoped in §3 above — not re-designed
  here.
- **Needs a decision?** No new one. The pre-auth-branding question (workspace-aware pre-auth route
  vs. accept platform branding pre-auth) is already flagged in §2 step 3 above; this pass just
  confirms the welcome-slideshow and install-banner sites are additional instances of the same
  open question, not separate ones.

### 2. Terminology — Hardcoded, more deeply than previously documented

- **Current state**: "Garage"/"Lot" is not a translatable label sitting on top of a neutral value —
  the words themselves are baked into the `locationType` enum comparison, repeated at roughly a
  dozen separate call sites: `location?.locationType === "lot" ? "Lot" : "Garage"` and the mirrored
  `"garage" ? "Garage" : "Lot"` form recur at `main.tsx:2993,3138,3630,12257,14038,20195,20543,
  21616,22622,22896`; dedicated `"+ Garage"` / `"+ Lot"` action buttons exist at
  `main.tsx:21600-21601,22578-22579`; a `garageLotEditable`/`onGarageCountChange` prop pair exists
  specifically for garage/lot counts (`main.tsx:21928-21976`); and the Sample Demo project's
  `type` field is itself the literal string `"Parking Garage"` (`main.tsx:11569,11721`, also
  `12778`'s fixed `<option>` list: Parking Garage / Surface Lot / Campus Parking / Mixed Parking).
- **Gap**: no terminology/label configuration layer exists anywhere — not for this word pair, not
  generically. A company selling something other than parking structures (e.g. warehouses, retail
  build-outs) would see "Garage"/"Lot" throughout Site Builder, Projects, and Sales with no way to
  relabel short of editing source.
- **Recommendation**: this is **not** a small UI addition. Two real paths exist: (a) a
  workspace-level string-override dictionary for the fixed set of domain nouns Ergon's UI
  hardcodes, decoupled from the underlying `locationType` value (lower risk — the enum value stays
  `"garage"`/`"lot"` internally, only the displayed label changes); or (b) generalizing
  `locationType` itself into an admin-defined list (bigger change — touches the Site Builder data
  model and the "Site type" fixed dropdown at `main.tsx:12778` too).
- **Needs a business/product decision?** Yes, explicitly flagging rather than picking: should
  terminology be a single global relabeling setting, or per-module/per-entity? This is exactly the
  kind of decision the task brief asked to surface, not resolve.

### 3. Roles/capabilities — Confirmed accurate; no new finding beyond current line numbers

- **Current state**: `ROLE_KEY_OPTIONS` (`main.tsx:16596`, 10 fixed roles), `ALL_TABS`
  (`main.tsx:481`, 12 fixed tabs), and `DEFAULT_TABS_BY_ROLE` (`main.tsx:517`) are all still fixed
  TypeScript constants, unchanged in shape since §1/§6 above (only line numbers moved). Per-user
  role assignment and per-user tab overrides remain genuinely no-code today (Team Roster
  `main.tsx:17234`, Pending Approvals `main.tsx:17196`).
- **Gap/Recommendation/Decision**: fully covered already by §6 above (`workspace_role_definitions`
  proposal) — not re-designed here. One boundary note worth adding for the summary below: because
  `workspaces`/`workspace_members` (Phase 1, migration 115) already exist and are live, an
  admin-editable role-vocabulary table could in principle be built and scoped to today's single
  real workspace **without waiting for a second workspace to exist** — it doesn't require real
  multi-tenant isolation, only the workspace-identity plumbing that already shipped.

### 4. Quote and document templates — Partial, and uneven across document types (new finding)

- **Current state**: Proposal Template is real and admin-editable (`main.tsx:17771`, "Seeded from
  EnSight's real proposal wording"), with a verified freeze-at-send guarantee (§4 above, unchanged).
  **Submittals have no template/boilerplate concept at all** — `handleCreateSubmittal`
  (`main.tsx:4764-4792`) builds its entire `contentSnapshot` from live project data only
  (`project.sow`, `project.bom`, `main.tsx:4784-4785`), with zero admin-edited boilerplate text.
  This is a materially different (and less mature) situation than Proposal Templates, not simply
  "also hardcoded" — there is no boilerplate to even harden later, because a Submittal's
  scope-of-work text lives per-project (`project.sow`, edited per project) rather than as a
  reusable company-wide template section.
- **Gap**: a second company would have to invent its own SOW boilerplate from scratch on every
  single project; there is no reusable, admin-maintained Submittal template to seed or customize.
- **Recommendation**: the Proposal Template pattern (admin-edited sections, frozen at send) is the
  proven model to copy if Submittals are meant to have standard boilerplate too — a real schema
  addition (a `submittal_template_sections`-shaped table), not a small tweak.
- **Needs a decision?** Yes: should Submittals get a template system at all, or is per-project
  freeform SOW authoring the intended permanent design? Not decided here.

### 5. Numbering formats — Hardcoded (confirmed, with one bug found resolved since the tenancy audit)

- **Current state**: quote refs (`SQ-YYYY-####`) and project refs (`PRJ-YYYY-####`) both have their
  prefix literal in code — `computeNextProjectRef` builds `` `PRJ-${year}-${String(maxRef +
  1).padStart(4, "0")}` `` with `"PRJ-"` as a hard literal (`src/persistence.ts:35-41`); the quote
  side follows the same pattern per its own comment (`src/persistence.ts:8600-8602`, "stable
  'SQ-2026-0001' reference"). No admin UI exists to change either prefix, the digit-padding, or the
  reset cadence. **One thing has changed since `PRODUCT_TENANCY_AUDIT.md` §1 flagged it**: that
  document's cited bug — a literally hard-coded `2026` inside the project-ref regex — is no longer
  present; `nextProjectRef()` now derives the year dynamically (`main.tsx:11677-11682`:
  `computeNextProjectRef(projectSites.map(...), new Date().getFullYear())`). Worth noting as
  resolved, not carried forward as an open item.
- **Gap**: a company with an existing numbering convention (a different prefix, a plant code, no
  year segment at all) cannot self-serve any of that.
- **Recommendation**: add an admin-configurable format setting per counter type (e.g. a template
  string like `{PREFIX}-{YEAR}-{SEQ:4}`) — small-to-medium: needs a settings table plus a formatter,
  but doesn't require touching the underlying per-year counter mechanism itself. Independent of the
  separate per-workspace-vs-global counter-scoping question already covered in
  `PRODUCT_TENANCY_AUDIT.md` §1/§10 item 9.
- **Needs a decision?** Minor one: should the reset cadence (per-calendar-year vs. never-reset)
  also become configurable, or stay fixed at "resets each year"? Flagging, not deciding.

### 6. Approval thresholds — Not implemented at all (new finding — not previously documented)

- **Current state**: a repo-wide search for dollar-threshold/approval-gate patterns found **no
  amount-based approval gate anywhere in the codebase**. The two real approval workflows that exist
  — Catalog Price Change Requests (`backend/supabase/migrations/046_catalog_pricing_and_specs.sql:
  28-60`) and Purchase Order Holds — are both purely role-based: *any* sales-rep price edit, of any
  size, requires manager approval (`main.tsx:2828,2863,18595,18765` — "goes to your manager for
  approval before it takes effect," no size check anywhere in that path). There is no "auto-approve
  under $X, require approval over $X" concept for catalog prices, purchase orders, or anything else.
- **Gap**: a company that wants, say, "POs under $500 auto-approve, over $500 need a manager" has no
  way to configure that — every approval gate today is all-or-nothing by role, never by amount.
- **Recommendation**: a real schema/workflow addition, not a small UI change — a new
  `approval_rules`-style table (entity type, dollar threshold, required role/role-tier), plus a
  threshold check inserted in front of each write path that currently gates purely on role.
  Recommend reusing the Catalog Price Change Requests propose/review/approve shape (already the
  reference pattern per §4/§7 above) as the mechanical template, with a threshold check gating
  whether the propose/review step is even triggered.
- **Needs a business decision?** Yes: should thresholds apply per entity type independently (PO,
  purchase request, catalog price change each with their own dollar figure), and should each be a
  single cutoff or tiered (e.g. $500/$5,000 mapping to different approver levels)? A genuine product
  decision, not decided here.

### 7. Notification rules — Confirmed strength, with one added detail

- **Current state**: `notification_rules` (migration `024_notification_rules_engine.sql`) plus the
  Admin > Notification Rules panel (`main.tsx:17480`, self-labeled "programmable, no code change
  needed") let an admin toggle in-app/email/Slack-Teams/push per event type with zero code —
  genuinely real, matching both documents' earlier assessment. New detail worth recording: the panel
  is unusually self-documenting for a no-code control — its own Slack/Teams checkbox carries an
  inline tooltip explaining the actual delivery mechanics (`main.tsx:17498`: DMs via
  `SLACK_BOT_TOKEN` + a stored Slack member ID, falling back to a shared-channel webhook if neither
  is configured yet) — a good example of a no-code panel that doesn't just expose a toggle but
  explains its own behavior to the admin using it.
- **Gap**: unchanged from `PRODUCT_TENANCY_AUDIT.md` §1/§6 — the event-type *catalog* itself is
  still fixed server-side in `api/_lib/notificationEvents.js:155-404` (`HANDLERS`/
  `SUPPORTED_EVENT_TYPES`), and the table is still a single global (not per-workspace) resource.
  Both already tracked elsewhere; not new findings.
- **Recommendation**: none — cite this panel as a positive reference implementation, the way
  Catalog Price Change Requests already is for the propose/review/approve pattern.
- **Needs a decision?** No.

### 8. Business hours/time zone — Effectively absent (confirmed, one narrow exception)

- **Current state**: a repo-wide search found no `timezone`/`business_hours` column or setting
  anywhere in the schema or the frontend, with one narrow exception: a client-side fix
  (`expiresOnToIsoEndOfDay`, `main.tsx:16609-16625`) that anchors "this sign-in's access expires on
  this date" to the *browser's local time* at the moment an admin approves it, specifically to avoid
  a real bug (a UTC-midnight parse making a freshly-approved user look already-expired for anyone
  west of UTC). This is a genuinely clever narrow fix, but it is not a stored company timezone
  setting — it's implicit, computed fresh from the approving admin's own browser each time, with no
  persistence or company-level meaning. The one cron job in the system
  (`api/cron/task-overdue.js`, per `PRODUCT_TENANCY_AUDIT.md` §3) compares `due_date` to "today"
  with no timezone context of any kind.
- **Gap**: matches `PRODUCT_ONBOARDING_CONFIG.md` §2 step 2's existing framing exactly ("Timezone
  matters immediately for task due dates, Schedule Template phase durations, and the
  `task-overdue` cron") — confirming, via direct code search, that nothing has since been built and
  the gap is total, not partial.
- **Recommendation**: add a `timezone` column wherever company identity ends up living (today's
  singleton `company_branding`, or its future per-workspace successor) and thread it through the
  cron's due-date comparison — real, bounded feature work since it touches a server-side cron job,
  not only a settings screen.
- **Needs a decision?** No new one — this confirms rather than changes the existing open item.

### 9. Project phases/statuses — Hardcoded via CHECK constraints (new, more precise finding)

- **Current state**: `projects.app_status` is fixed by a CHECK constraint to exactly `('Draft',
  'Planning', 'Purchasing', 'Staging', 'Install Ready')`
  (`backend/supabase/migrations/022_phase10_projects_cutover.sql:21-22`) — a more precise finding
  than either existing document, which discussed `TASK_STATUS_OPTIONS`/`PURCHASE_ORDER_STATUSES`
  but not this project-level status enum specifically. The same migration also fixes purchase-request
  line status to `('Need Quote', 'Not started', 'Ordered', 'Completed', 'From Inventory',
  'Delivered to Office', 'Delivered to Client')` (`022:69-70`), with the literal value list
  re-matched again at insert/backfill time (`022:127,204`: `case when elem->>'status' in (...) then
  ... else 'Draft'/'Not started' end`). No admin UI exists for any of these enums (project, task,
  purchase-request line, PO) — every one requires a migration plus a source change to every switch
  statement that compares against the literal string.
- **Gap**: a company with a different delivery workflow (e.g., an extra "Permitting" phase before
  "Install Ready") cannot add it without both a migration and hunting down every string-literal
  comparison against the old fixed list.
- **Recommendation**: turning a CHECK-constraint enum into an admin-editable ordered list is a real
  schema/architecture decision — a `workspace_status_definitions`-shaped table, the same pattern
  already proposed for roles (`workspace_role_definitions`, §6 above) — not a small UI addition,
  because status values are pattern-matched as literal strings throughout both `main.tsx` and
  `persistence.ts`, not looked up through one central table.
- **Needs a business decision?** Yes: should statuses become freely admin-orderable/renamable
  (higher risk of breaking string-literal comparisons elsewhere in the code), or should Ergon
  instead offer a small number of pre-built workflow presets to choose from at onboarding (lower
  risk, and consistent with the "starter configuration" pattern §7 above already proposes for
  catalog taxonomy)? Flagging, not deciding.

### 10. Inventory categories — Hardcoded, and a small, low-risk fix candidate (new finding)

- **Current state**: distinct from the separately-documented Product Catalog's
  `CATALOG_CATEGORY_OPTIONS` (10 categories), the Inventory module's own Add/Edit Part form has its
  "Category" field as a literal inline `<select>` with six hardcoded options typed directly into the
  JSX — not even drawn from a named constant array: `main.tsx:10947`: `<select
  value={itemDraft.category} ...><option>Base</option><option>Communications</option>
  <option>Power</option><option>Lighting</option><option>Display</option><option>Build</option>
  </select>`. The underlying database column, `inventory_items.category text`
  (`backend/supabase/migrations/001_initial_ops_schema.sql:82`), has **no CHECK constraint at all**
  — the enum is enforced only by this one dropdown's fixed options, not by the schema.
- **Gap**: an admin cannot add, rename, or remove an inventory category without editing this JSX
  directly; the six values are specific to Ergon's own hardware-build workflow (e.g. "Build" is a
  manufacturing-recipe category), not generic to other businesses.
- **Recommendation**: because the database column is already unconstrained free text, this is a
  genuinely **small, low-risk fix** — replace the six hardcoded `<option>` tags with an
  admin-managed list. Ergon already has a proven UI pattern for exactly this shape of "genuinely
  open-ended, admin adds any value as free text" control: Standard Install Times
  (`main.tsx:17513-17518`), which already keys its own logic off inventory category strings.
- **Needs a decision?** No — flagging this as a good small-UI-addition candidate, not a business
  decision.

### 11. Custom fields — Confirmed absent, as expected

- **Current state**: a repo-wide search for `custom_field`/`customField` returned zero matches
  anywhere in `src/` or `backend/supabase/migrations/`. The one genuinely flexible field-adding
  mechanism that exists — the Form Builder (`form_schemas`/`form_schema_fields`/
  `form_schema_field_options`, migration `026_phase18_fluid_forms_handover.sql:12-43`, admin UI at
  `main.tsx:17616`/`17628`) — is scoped to exactly two purpose-built schemas (After-Sales Handover,
  Site Intake Questionnaire), not a general "add a field to any entity" capability. An admin cannot
  add a custom field to `clients`, `projects`, `inventory_items`, `purchase_orders`, or any other
  core entity without a schema migration.
- **Gap**: exactly as expected — no general custom-field capability exists anywhere.
- **Recommendation**: the Form Builder's schema shape is architecturally the right pattern to
  generalize from, but making it attach to arbitrary entities (rather than the two purpose-built
  forms it serves today) is a real architecture decision — most likely an EAV-style
  `entity_custom_field_values` table plus per-entity-type field definitions, not a small addition.
- **Needs a decision?** Yes: which entities need custom fields first (clients? projects? catalog
  items? all of them?) — a scoping decision, not answered here.

### 12. Onboarding checklist — Confirmed nothing exists today

- **Current state**: a repo-wide search for "onboarding"/"getting started" found only a placeholder
  string — "Reference guides and onboarding materials" (`main.tsx:7862`) — inside the still-unbuilt
  Learning Library (`LIBRARY_CATEGORIES`, `main.tsx:16818`, whose own surrounding comment calls it
  "an honest empty state... real guides don't exist yet"), and the first-login welcome slideshow
  (`main.tsx:16860`s region, four static informational slides, not a task checklist). Neither is a
  step-by-step "you still need to do X" checklist for a new admin.
- **Gap/Recommendation/Decision**: fully covered already by §2 step 10 and
  `PRODUCT_ONBOARDING_CONFIGURATION_PLAN.md` §12's proposed `workspace_onboarding_state`/
  `workspace_onboarding_progress` table — this pass confirms, via direct code search, that the gap
  those sections describe is real and total, not partially addressed by anything already shipped.

### 13. Data import — Partial, and more real today than either existing document's brief mention suggests

- **Current state**: a genuine bulk-import flow already exists for the Sales/Product Catalog: an
  "Upload a list of items" modal accepts `.xlsx`/`.csv` (`main.tsx:19090-19129`), parses rows
  client-side, and shows a **preview table** (Product / Tags / Manufacturer / Sell Price / Linked
  Ref columns) before commit — a real preview-before-commit UX, not a blind upload — and explicitly
  tells the admin what happens to unmapped data rather than silently dropping it: *"Category will be
  set to 'Uncategorized' for all rows... the source file's category text is kept as a tag so
  nothing's lost"* (`main.tsx:19109`). No equivalent import exists for Clients, Vendors, or any
  other entity — those are still one-by-one through their own "Add" forms. The only other bulk-data
  paths are CSV *exports* (numerous, e.g. `main.tsx:9951,16231`) and the AI-driven single-quote PDF
  extraction (`api/sales-quote-extract.js`), which is a one-quote-at-a-time workflow, not a bulk
  import.
- **Gap**: matches §9 above's assessment exactly — generalizing the existing catalog-import pattern
  to Clients/Vendors/etc. is real, scoped work, not yet done for anything but the catalog.
- **Recommendation**: the existing catalog import (`main.tsx:19090-19129`) is a strong, ready-to-
  generalize reference implementation — this pass sharpens §9's existing recommendation with
  concrete evidence of exactly how good the existing pattern already is (preview + honest
  data-loss messaging), rather than proposing something new.
- **Needs a decision?** None new beyond what §9 already flags (all-or-nothing vs. partial-success
  handling for entities beyond the catalog).

### 14. Demo/sample-data isolation — Partial risk, already well covered, one fresh confirmation

- **Current state**: both previously-flagged real-client-identifying hardcoded objects (the dead
  `projects` array, the `emeraldQueenImportedProject` fallback) were already found and fixed per
  `PRODUCT_TENANCY_AUDIT.md` §10 item 7 (commit `af8e1b0`) — confirmed still fixed as of this pass;
  no "Emerald Queen"/"Newport News Shipbuilding"/"Straub Medical" literal strings were found
  anywhere in `main.tsx` beyond what those documents already describe. What is not yet built: any
  actual demo/sample-data *workspace*. There is exactly one real workspace today ("Ergon Test
  Workspace"), holding live operational data, with no `is_demo` flag or separated seed dataset
  anywhere. The `sampleDemoImportedProject` fallback (the renamed, fictionalized former
  `emeraldQueenImportedProject`) is fictional *content* injected into the one real production
  environment on a narrow AI-extraction-failure trigger — it is fictional filler data living inside
  real production data, not an isolated demo mode or sandbox.
- **Gap**: no actual demo/sample workspace exists yet; the one thing that superficially looks
  demo-like lives inside the single real environment, not a separated sandbox.
- **Recommendation**: fully covered by §8 above's sequencing (do not create a public demo workspace
  before Phase 3 RLS containment lands) — no new recommendation; this pass just confirms the current
  state matches what that section already assumes.
- **Needs a decision?** None new.

### 15. Engineering/Development (future module boundary) — No dedicated schema yet, but real attachment points already exist (new finding)

- **Current state**: `PRODUCT_PLAN.md:144-158` describes Engineering/Development as explicit future
  scope needing site requirements, sold scope, drawings/submittals/specs, technical review states,
  and "release packages" for Purchasing/Production/Project teams. Checking what already exists to
  attach a future module to: `project_documents` already has a `drawings` document type
  (migration `096_project_documents_drawings_type.sql`); the Submittal system (migrations `025`,
  `053`) already carries a versioned proposed/reviewed/responded lifecycle; `sales_quotes` and
  `project_locations`/`project_location_items` already carry sold scope and product-configuration-
  to-location relationships. No dedicated `engineering_reviews`/`technical_approvals`/
  "release package" table exists anywhere across the 127 migrations (confirmed by search).
- **Gap**: matches `PRODUCT_ONBOARDING_CONFIGURATION_PLAN.md` §16's existing assessment exactly —
  "no existing code or product-plan precedent found... needs a scoping conversation with E."
- **Recommendation**: confirming that assessment; adding one concrete detail found this pass — a
  future Engineering module's natural foreign-key anchor points are `projects`/`sales_quotes` (both
  already `workspace_id`-scoped per Phase 2, `PRODUCT_TENANCY_AUDIT.md` §9) plus the existing
  `project_documents` drawings type and the Submittal version pattern — so whenever this module is
  scoped, it has real existing conventions to extend rather than starting from nothing.
- **Needs a decision?** Yes, as already flagged elsewhere — a scoping conversation with the product
  owner before any design work begins. Not decided here.

### 16. Post-project Service/Support (future module boundary) — Partial; a real foundation already exists (new finding)

- **Current state**: `installed_assets` (migration `089_client_ledger.sql:19`) already carries a
  required `serial_number`, and the parent `projects` table already carries a
  `warranty_expiration_date` column (`089:53`) — genuine closeout/support-relevant data that exists
  and is populated today, matching `PRODUCT_PLAN.md:168-184`'s own description of what Closeout
  should produce and what a future Support module needs ("installed products... serial numbers...
  warranty start and expiration dates"). No `support_ticket`/`service_case`/`service_request` table
  exists anywhere (confirmed by search) — matching `PRODUCT_TENANCY_AUDIT.md` §2's cross-reference
  table finding ("Support case — Not found") exactly.
- **Gap**: the installed-asset/warranty *data foundation* exists; the actual support-case/ticket
  *workflow* on top of it does not.
- **Recommendation**: confirming `PRODUCT_ONBOARDING_CONFIGURATION_PLAN.md` §15's flagged-not-
  designed status is accurate, with the concrete addition that `installed_assets`/
  `projects.warranty_expiration_date` are real, populated today, and are the natural foreign-key
  anchor for a future `service_cases`/`support_tickets` table — this module also does not start
  from nothing.
- **Needs a decision?** Same as §15's own open item in that document — "who do they contact and how
  does that surface in-app" remains undecided. Not decided here.

---

### Configuration boundaries: what's safe to build before real multi-tenant isolation exists

Ergon has exactly one real workspace today (Phase 1/2 of the tenancy work are live, per
`PRODUCT_TENANCY_AUDIT.md` §9, but Phase 3 RLS containment is not). The question this section
answers directly: of the 16 areas above, which improvements are safe, additive, and
**workspace-count-independent** — buildable and shippable now, for the one real workspace, with no
tenant-isolation prerequisite — versus which ones **only make sense once a second workspace
actually exists** (or once Phase 3 RLS containment specifically lands)?

**Safe, additive, buildable now — no second workspace or RLS work required:**

| # | Area | Why it's safe now |
|---|---|---|
| 1 (partial) | Business branding — the hardcoded-render-site wiring fix (welcome slideshow, default state, install banner) | Pure UI wiring to the *existing* `company_branding` singleton; doesn't touch the singleton-to-per-workspace schema question |
| 3 (partial) | New role vocabulary as an admin-editable table | `workspaces`/`workspace_members` (Phase 1) already exist; a role-definitions table can be scoped to today's one real workspace without waiting for a second one |
| 4 | Submittal Template system | Purely additive; no tenancy dependency at all |
| 5 | Configurable numbering prefix/format | Independent of the separate per-workspace-counter-scoping question |
| 6 | Approval thresholds | New table + check, usable today for the one real workspace |
| 8 | Business hours/time zone | A single company-level timezone field works fine with exactly one company |
| 9 (partial) | Admin-editable project/task/PO status list | Same reasoning as role vocabulary — workspace-identity plumbing already exists |
| 10 | Inventory categories | Smallest, lowest-risk item on this whole list — DB column is already unconstrained free text |
| 11 | Custom fields | Larger lift, but architecturally independent of tenancy |
| 12 | Onboarding checklist | Useful for the one real workspace today, not dependent on a second one existing |
| 13 | Generalized data import beyond the catalog | The existing per-row `workspace_id`-stamping trigger pattern (§9 above) means an import UI is safe to build regardless of how many workspaces exist |
| 15 | Engineering/Development schema discovery | Design/scoping conversation can start now; new tables should be built `workspace_id`-scoped from day one per the already-decided working default (`PRODUCT_TENANCY_AUDIT.md` §10 item 10), but that's a design habit, not a prerequisite |
| 16 | Service/Support schema discovery | Same reasoning as #15 |
| 2 (conditional) | Terminology relabeling, **if** built as a single global setting | Workspace-independent only under that specific design choice — see below |

**Only make sense once a second workspace exists (or once RLS containment specifically lands):**

| # | Area | Why it's gated |
|---|---|---|
| 1 (remainder) | Converting `company_branding` from singleton to per-workspace row | Structurally requires a second workspace to have something to differ *from* |
| 2 (conditional) | Terminology relabeling, **if** the decision instead lands on per-workspace terminology | Only meaningful once two workspaces could plausibly want different labels |
| 14 | Demo/sample-data isolation | Explicitly and directly blocked on Phase 3 RLS containment per §8 above's own sequencing — building this before then would not actually isolate anything, regardless of how carefully the seed data is authored |

**Note on #7 and the rest**: Notification Rules (#7) needs no further work either way — it's
already a genuine no-code strength, independent of tenancy status. Quote/document templates (#4)
Proposal side is likewise already workspace-independent-safe (it already works and is already
"one company's" content); only the Submittal-side addition is new, and it's listed above as safe.

This split matters concretely for sequencing: eleven-plus of the sixteen areas reviewed here can
improve Ergon's self-serve configurability for its **one existing customer** immediately, entirely
decoupled from the tenant-isolation roadmap in `PRODUCT_TENANCY_AUDIT.md` — none of them require, or
should wait for, a second company or workspace to exist first.

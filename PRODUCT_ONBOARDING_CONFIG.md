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

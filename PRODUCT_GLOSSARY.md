# Ergon Product Terminology Glossary

Purpose: one place to resolve what a term means in Ergon specifically, since several of these
words (client, customer, project, subscription) carry different meanings in general SaaS usage
than they do in this codebase. Each entry states what exists **today**, in the real schema/code,
distinct from what's **planned** — per this repo's standing rule against marketing a planned
feature as already shipped.

Terms are cross-referenced to `PRODUCT_TENANCY_AUDIT.md` §2 (the original "shared records that
connect the lifecycle" inventory) and `PRODUCT_PHASE2_PLAN.md` (the Clients + Sales Quote
ownership work), which remain the fuller evidence sources — this glossary is a summary, not a
replacement for either.

---

### Workspace

**Exists today.** The real, database-enforced tenant boundary — one row in the `workspaces` table
(`id`, `name`, `slug`, `status` — `'active'` or `'suspended'`). Introduced in migration 115
(Phase 1), currently exactly one workspace exists in production: **"Ergon Test Workspace"**
(slug `ergon-test`), holding Ergon/Ensight's real operational data — renamed from an initial
"Ergon"/`ensight` naming in migration 116 specifically so it's understood as a general
product-development and testing workspace, not a permanently-Ensight-branded one. It is **not**
a public demo and holds real records; a future public demo requires a separate, isolated,
fictionally-seeded workspace (`PRODUCT_PHASE1_PLAN.md`, `PRODUCT_TENANCY_AUDIT.md`).

`clients` and `sales_quotes` (and everything under them) now carry a real `workspace_id` (Phase
2, migrations 117-118) — but **RLS does not yet restrict access by workspace anywhere in the
app**. A workspace today is real ownership metadata, not yet an access boundary. That boundary is
Phase 3 (`PRODUCT_PHASE3_PLAN.md`, scoped, not implemented).

### Client

**Exists today, but functionally disconnected from the live app.** The `clients` table (migration
102: `id`, `name` unique, `created_at`) is a real table with a working `createClient`/
`loadClients` pair in `persistence.ts` — but no UI in the app actually calls `createClient()`
today (confirmed by code trace, `PRODUCT_PHASE2_PLAN.md` §3.1's application-code audit). The only
place `clients` data is used in the live app is rendering one chat channel per client in the
Messages sidebar. `sales_quotes.client_id`/`projects.client_id` are nullable FKs to `clients`
that were only **partially** backfilled once, at migration time — most quotes and projects
today identify their client by a free-text `client_name` string, not a real `clients` row.

Do not confuse this with **Client Ledger** (a UI-computed view over `installed_assets` and
related project data — not its own table, `PRODUCT_TENANCY_AUDIT.md` §2) or with **Contact** (see
below).

### Customer

**Not a distinct database concept from Client.** Ergon's product language (`PRODUCT_PLAN.md`) and
day-to-day usage both use "client" and "customer" interchangeably for the company/person Ergon is
selling to or servicing. There is no separate `customers` table. Where this glossary or other docs
say "client," they mean the same thing "customer" would mean in general SaaS usage.

### Contact

**Does not exist as a dedicated table.** `PRODUCT_TENANCY_AUDIT.md` §2 confirmed no external
customer-contact table exists anywhere in the schema; `team_members`/`app_known_users` only cover
*internal* Ergon people. `sales_quotes` has free-text contact fields (`contact_full_name`,
`contact_phone`, `client_email`) directly on the quote itself, not a normalized Contact entity a
Client can have many of. This is one of the "doesn't exist yet, can be designed workspace-scoped
from day one" items `PRODUCT_TENANCY_AUDIT.md` §2 calls out.

### Site

**Exists today, split across three separate tables, not unified.** `locations` (a standalone
table), `project_locations` (a project's own physical locations), and `sales_quote_locations` (a
quote's proposed locations) each independently represent "a place where equipment goes." There is
no single `sites` table a Client/Contact/Opportunity/Quote/Project all point to — a site's
identity is re-created at each stage rather than carried through as one persistent record. This
is a real product gap `PRODUCT_TENANCY_AUDIT.md` §2 and the Phase 2 research both note but do not
propose fixing as part of any phase scoped so far.

### Opportunity

**Does not exist.** No CRM pipeline/opportunity/deal-stage table exists anywhere in the schema —
confirmed by `PRODUCT_TENANCY_AUDIT.md` §2. A "Lead → Opportunity → Quote" journey, as commonly
understood in CRM tools like HubSpot, has no "Opportunity" stage represented in Ergon today; a
Sales Quote is effectively both the opportunity and the quote in one record. This matches
`PRODUCT_PLAN.md`'s own framing of Opportunity as future scope.

### Quote (and Proposal)

**Both exist today, and are distinct from each other.** A **Quote** is a `sales_quotes` row —
the internal working record (client/site info, BOM lines, locations, pricing, status). A
**Proposal** is a `sales_quote_proposals` row — a frozen, versioned **snapshot** of a quote's
content (`content_snapshot` JSON, resolved BOM/pricing/template text at the moment it's created),
sent to the customer via a public share-token link for them to approve, reject, or request a
revision on, with no login required. Editing the live quote *after* a proposal was sent does not
change what the customer already received — each proposal is its own frozen copy
(`PRODUCT_PHASE2_PLAN.md` §3.3). A quote can have multiple proposal versions over time as it's
revised.

Every quote gets a stable, human-facing reference like `SQ-2026-0001` (`quote_ref`), assigned
once, server-side, at creation (migration 066) — currently global-year-scoped, planned to become
per-workspace-year-scoped in migration 119 (`PRODUCT_PHASE2_PLAN.md` §7).

### Project

**Exists today.** A `projects` row — the operational record once work is actually happening
on-site (BOM, scope of work, locations, shipments, documents, tasks). A project can be created
manually or converted from a Closed-Won quote (`createProjectFromClosedWonQuote()`, which copies
locations/BOM/items/images and leaves a real, durable `source_sales_quote_id` FK back to the
originating quote). `projects` does **not** yet have its own `workspace_id` — it's a separate,
not-yet-scoped table group, with a recorded forward dependency on how to backfill it once its own
phase happens (`PRODUCT_PHASE2_PLAN.md` §2.3).

Every project gets a `PRJ-2026-####` reference, generated client-side (`nextProjectRef()` in
`main.tsx`, fixed 2026-09-08 to derive its year dynamically instead of a hardcoded 2026 — see
`HANDOFF.md`) — unlike a quote's `quote_ref`, this one has no server-side counter table backing
it; it's derived by scanning existing project refs in the currently-loaded `projectSites` array.

### Installed asset

**Exists today.** The `installed_assets` table (migration 089, "Client Ledger" work) — equipment
that's been installed at a customer site, tracked for warranty/lifecycle purposes (expected
lifespan, kickoff/warranty dates). This is the real table behind what the UI calls "Client
Ledger." Not yet workspace-scoped.

### SaaS subscription / Service entitlement

**Does not exist as a dedicated concept.** `projects` has a handful of SaaS-related columns
(`saas_type`, `saas_contract_amount`, `saas_billing_frequency`, `saas_start_date`,
`saas_renewal_date`) added as a placeholder (migration 073) — `HANDOFF.md` explicitly documents
this as placeholder data, not yet populated with real figures, and not backed by any actual
subscription-management or entitlement-checking logic. There is no "what does this customer's
active SaaS plan entitle them to" concept anywhere in the app. **Do not confuse this with
product-account subscription billing** (Ergon customers paying Ergon-the-company for the app
itself) — that's explicitly out of scope/deferred per every planning document that mentions it;
this glossary entry is about Ergon's *own customers'* SaaS service contracts (e.g., an annual
software-and-support agreement), which is a real, if placeholder-stage, product feature.

### Support case

**Does not exist.** No support-ticket/case table exists anywhere in the schema. Matches
`PRODUCT_PLAN.md`'s own framing of Service/Support as future scope — nothing in Ergon today
tracks a customer support request as its own record.

### Workspace admin

**Exists today.** `workspace_members.is_workspace_admin` (migration 115) — a per-workspace,
per-user boolean. A workspace admin can manage that one workspace's memberships and roles
(`is_workspace_admin(workspace_id)` policies, migration 115) but has no access to any other
workspace and no platform-level capability. Distinct from a **manager** role
(`workspace_member_roles.role_key = 'manager'`), which is an *operational* role within a
workspace (day-to-day permissions), not the workspace-administration capability itself — a user
can validly be a workspace admin with zero operational roles, or vice versa.

### Platform admin

**Exists today as a structure, but the roster is deliberately empty.** `platform_admins`
(migration 115) — a small, separate table for Ergon's own product-operations staff, distinct from
any customer's workspace administration. `is_platform_admin()` grants cross-workspace visibility
in places it's checked (e.g. reading the full `workspaces` list). **Confirmed empty in production
as of every verification pass through 2026-09-08** — no account, including the one existing
`app_admins` account, has been granted platform-admin status. Per every planning document that
addresses it, this is a deliberate, separate, not-yet-made decision, not an oversight.

---

*This glossary reflects verified schema/code state as of 2026-09-08. If a term's underlying table
or behavior changes in a future migration, update this file in the same pass — don't let it drift
the way `PRODUCT_START_PLAN.md`/`PRODUCT_TENANCY_AUDIT.md`'s Phase 1/2 status statements did before
tonight's reconciliation pass.*

# Stage 2 Product Schema Plan — Capabilities, Billing Clearance, Conversion Approval, PM Assignment

Status: **design-only, produced as part of an overnight autonomous work pass. Not reviewed line-by-line with E yet. No migration created or run.** This formalizes decisions already made across `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` Part 9 into one standalone, implementation-ready schema plan. Where this document and that one differ in a wording nuance, the decision document is the source of truth for *what was decided*; this document is the source of truth for *the concrete schema* to build it with.

Do not build a full Billing module or billing-information section — this covers only the minimum handoff-clearance state E explicitly asked for.

---

## 1. Design principle: capabilities, not role names

Every permission this plan introduces is checked via a **capability grant**, never a hardcoded `role_key` string in application logic or RLS. A workspace admin can move a capability from one role to another later with no code deploy. Role-based defaults exist only as the *initial* seed of who holds which capability.

```sql
create table public.capabilities (
  key text primary key,
  label text not null,
  description text not null
);

create table public.workspace_role_capabilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_key text not null,
  capability_key text not null references public.capabilities(key),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  unique (workspace_id, role_key, capability_key)
);
```

Business logic checks `exists (select 1 from workspace_role_capabilities wrc join workspace_member_roles wmr on wmr.role_key = wrc.role_key ... where wrc.capability_key = 'x' and wrc.workspace_id = <active>)` for the caller's own roles — never `if role_key = 'billing'`.

**Initial capability catalog** (proposed, confirmed as a working draft in Part 9.7.3 — finalize exact keys at implementation time, not before):

| Key | Default holder role | Purpose |
|---|---|---|
| `view_billing_handoff_items` | `billing` | See which quotes are awaiting clearance |
| `record_down_payment_status` | `billing` | Mark required/received/waived/not_required |
| `record_billing_clearance` | `billing` | Finalize clearance so conversion can proceed |
| `return_handoff_to_sales` | `billing` | Send a handoff back to Sales for correction |
| `approve_sale_to_project_conversion` | `manager` | Approve a submitted conversion (must not be the submitter) |
| `manager_link_override` | `manager` | Temporarily disable / regenerate a link owned by someone else, with mandatory reason |
| `admin_link_override` | `admin` | Emergency link action, with mandatory reason |

## 2. Billing clearance — lives on the quote, snapshotted at conversion

Per Part 9.7.2's recommendation (down-payment clearance must exist before a project formally exists, so it can only attach to the quote):

```sql
alter table public.sales_quotes add column billing_clearance_status text
  check (billing_clearance_status in ('required', 'received', 'waived', 'not_required'));
alter table public.sales_quotes add column billing_clearance_amount numeric(12,2);
alter table public.sales_quotes add column billing_clearance_reason text; -- waiver/not-required explanation
alter table public.sales_quotes add column billing_clearance_recorded_by uuid references auth.users(id);
alter table public.sales_quotes add column billing_clearance_recorded_at timestamptz;
```

**Immutable history, not overwrite-in-place** — every change to clearance status is a new row, never an update to the quote's own columns alone:

```sql
create table public.billing_clearance_history (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  status text not null check (status in ('required', 'received', 'waived', 'not_required')),
  amount numeric(12,2),
  reason text,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
```

The quote's own `billing_clearance_*` columns always reflect the LATEST history row (kept in sync by the RPC that writes both, in one transaction — same atomic-dual-write discipline as migration 124's bridge functions). The history table is what "preserve the quote's original clearance history rather than silently overwriting it" (E's decision, migration-124 round) actually means in schema form.

## 3. Conversion request and separate approval — two-party, not self-approval

Per E's explicit decision: Sales submits, a *different* capability-holder approves, admin may emergency-override with a mandatory reason.

```sql
create table public.quote_conversion_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'emergency_approved')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  emergency_reason text,
  project_id uuid references public.projects(id) -- set once the project is actually created
);
```

**Enforced at the RPC level, not just documented**: the approving RPC must reject `approved_by = submitted_by` unless the path taken is `emergency_approved` by someone holding `admin_link_override`-equivalent emergency authority (exact capability key TBD at implementation), and must reject approval entirely unless `sales_quotes.billing_clearance_status in ('received', 'waived', 'not_required')` for that quote first.

## 4. Project handoff record — the clearance snapshot, immutable

Per E's decision: "copy a read-only snapshot of the clearance into the project handoff record... preserve the quote's original clearance history rather than silently overwriting it during conversion."

```sql
create table public.project_handoff_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_quote_id uuid not null references public.sales_quotes(id),
  conversion_request_id uuid not null references public.quote_conversion_requests(id),
  billing_clearance_status_snapshot text not null,
  billing_clearance_amount_snapshot numeric(12,2),
  billing_clearance_reason_snapshot text,
  billing_clearance_recorded_by_snapshot uuid,
  billing_clearance_recorded_at_snapshot timestamptz,
  assigned_pm_workspace_member_id uuid references public.workspace_members(id),
  created_at timestamptz not null default now()
);
```

This is a snapshot, written once at conversion time, never updated afterward — the quote's own `billing_clearance_history` remains the live, ongoing record if the quote itself is ever revisited (e.g. a partial deposit later becomes a full one); the project's copy stays frozen at what was true at handoff.

## 5. Assigned PM — a real workspace member, not free text

Per E's decision ("Add an assigned PM field connected to a real workspace member"):

```sql
alter table public.projects add column assigned_pm_workspace_member_id uuid references public.workspace_members(id);
alter table public.projects add column pm_assigned_at timestamptz;
alter table public.projects add column pm_assigned_by uuid references auth.users(id);
```

**Reassignment history** (required by the PM-reassignment decision — "record the reassignment"):

```sql
create table public.project_pm_reassignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  previous_pm_workspace_member_id uuid references public.workspace_members(id),
  new_pm_workspace_member_id uuid not null references public.workspace_members(id),
  reassigned_by uuid not null references auth.users(id),
  reassigned_at timestamptz not null default now(),
  reason text
);
```

## 6. Stage-based Sales-to-PM submittal authority

The RLS/RPC-level check (not a new table — this is a *rule*, expressed by joining existing/new tables):

Submittal authority = Sales, **until all four hold true**: `sales_quotes.billing_clearance_status in ('received','waived','not_required')` AND a `quote_conversion_requests` row exists with `status in ('approved','emergency_approved')` for that quote AND `projects.id` exists (`source_sales_quote_id` set, per migration 064) AND `projects.assigned_pm_workspace_member_id is not null`. Once true, authority = the *specific* `assigned_pm_workspace_member_id` — enforced by comparing `auth.uid()` to that workspace_member's `user_id`, not by checking role membership generally. Sales retains read-only access to submittal history via a straightforward `select`-only RLS branch, permanently, regardless of handoff state.

## 7. Manager/admin override — reason mandatory, notification to the actual owner

No new table beyond the audit-log table already planned in the share-link decision document (Part 9.4) — override actions on submittals/proposals/links all write to that same `link_actions`/audit table, with `reason` as a NOT NULL column specifically for override-category events, and a notification fired to the document's real owner (never the actor) using the existing, already-working notification system (migrations 119-124's pattern).

## 8. Quote-deletion and link-disable audit events

Already fully designed in the share-link decision document, Part 9.4 and Part 9.6 item 6 — `quote_soft_deleted`, `disabled_by_quote_deletion` (cross-referenced to the causing event), `quote_restored`, `link_reenabled_after_quote_restore`. Not repeated here; this document only cross-references it so the two schema plans don't drift out of sync with each other.

## 9. What this plan deliberately does NOT include

- No Billing module (invoicing, payment processing, ledger reconciliation) — only the minimum clearance-status field set E asked for.
- No SaaS/product subscription billing (already deferred per standing product-plan decisions).
- No actual migration file — this is design-only, per the overnight-queue boundary ("Do not create or run this migration").
- No capability catalog finalized in stone — Part 9.7.3 explicitly treats it as a working draft until Stage 2's real schema review.

## 10. Sequencing dependency on the authorization bridge (Part 9.0/11)

This entire plan assumes `workspace_members`/`workspace_member_roles` are reliable, in-sync, and safe to build new foreign keys against — which depends on migration 124 (the authorization bridge) being live, tested, and its drift report staying clean. **This plan cannot start implementation before migration 124 is confirmed deployed and Task 3's migration 125 (or an equivalent decision to defer it) is resolved** — building `assigned_pm_workspace_member_id` against a `workspace_members` table that might still silently drift from the legacy roles table would inherit that same risk into brand-new Stage 2 data.

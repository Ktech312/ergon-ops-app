-- Phase 3, Stage 2 (Projects, tasks, locations, BOM, and related delivery
-- records) -- approved by E under the same 2026-09-16 standing
-- authorization as migration 155. This is the OWNERSHIP half of Stage 2,
-- mirroring the exact two-step pattern already proven safe for Clients +
-- Sales (migration 117 = ownership, migration 155 = RLS): this migration
-- adds real, trigger-enforced workspace_id to the two ROOT tables of this
-- group (projects, tasks) and backfills every existing row -- it does
-- NOT change any RLS policy. Both remain exactly `using(true)`/`with
-- check(true)` after this migration, unchanged. RLS tightening for this
-- group is a separate, later migration, once this ownership metadata is
-- live and verified -- matching migration 117's own header exactly.
--
-- Table-group scope for Stage 2, decided by revalidating the current FK
-- graph against the standing authorization's own stage boundaries
-- (topical, not mechanical FK-graph inclusion -- a table having an FK to
-- projects does not automatically make it "Projects" stage if its own
-- domain is named as a LATER stage):
--   - `projects` (root, this migration).
--   - `tasks` (root, this migration -- see the design note below for why
--     it needs its own real backfill logic, not a trivial parent lookup).
--   - Direct/nested children inheriting ownership through their FK, no
--     new column, RLS added in a later migration: project_locations,
--     project_location_images, project_location_items,
--     project_scope_of_work, project_bom_lines, project_submittals,
--     project_handovers, project_stakeholders, installed_assets,
--     project_conversion_receipts, task_hardware_dependencies,
--     task_activity_log.
--   - Deliberately EXCLUDED from Stage 2, confirmed by direct schema
--     read, not assumed: `project_documents` (Stage 4 -- "Documents,
--     notifications, channels, jobs, share-link records, and storage" is
--     its own named stage); `project_shipping_addresses`/
--     `project_shipments`/`project_shipment_lines`/
--     `project_shipment_photos` (Stage 3 -- "Purchasing, inventory,
--     vendors, warehouses, and RECEIVING" is the closer topical match);
--     `project_schedule_templates`/`project_schedule_template_phases`
--     (no `project_id` column at all -- a GLOBAL admin-configured
--     template library, same shape as `standard_install_times`/
--     `notification_rules`, Stage 5 -- "workspace-scoped uniqueness...
--     functions" -- territory, not per-project data);
--     `project_ref_counters` (a shared counter table like
--     `sales_quote_ref_counters`, same Stage 5 exclusion reasoning as
--     Group 1's own `sales_quote_ref_counters` exclusion, migration 155).
--
-- Design note: tasks.workspace_id derivation. `tasks` has NO real FK to
-- `projects` -- only a loose `project_ref text` column (matched against
-- a project's ref/name client-side) and a `section` categorization that
-- spans multiple business domains, many not project-specific at all
-- (warehouse/purchasing/inventory/sales/engineering/general). Rather
-- than fuzzy-match `project_ref` text against `projects.project_name`
-- (fragile, and semantically wrong for the many tasks that were never
-- about a specific project at all), this migration derives
-- tasks.workspace_id the SAME way migration 117's own trigger derives
-- clients/sales_quotes.workspace_id going forward: from the task's own
-- creator's workspace membership (`tasks.created_by`, already a real FK
-- to auth.users). This is a routine, low-risk implementation default,
-- not a business decision requiring E's input -- it is a direct,
-- mechanical extension of the identical pattern already approved and
-- live for Clients/Sales, not a new design. A task with no creator
-- recorded (created_by is null, a pre-existing nullable column) falls
-- back to the single existing active workspace, exactly like every
-- other unresolvable backfill row in this migration.
--
-- Confirm 156 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, made NOT NULL later in this
-- same transaction.
-- ============================================================

alter table public.projects
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.tasks
  add column if not exists workspace_id uuid references public.workspaces(id);

-- ============================================================
-- Section 2 -- Indexes
-- ============================================================

create index if not exists idx_projects_workspace_id on public.projects(workspace_id);
create index if not exists idx_tasks_workspace_id on public.tasks(workspace_id);

-- ============================================================
-- Section 3 -- Backfill. Idempotent: every update matches zero rows
-- (no-op) on any re-run, since it only ever targets workspace_id is
-- null.
-- ============================================================

-- projects: prefer the linked client's workspace, then the linked
-- source quote's workspace, then the single existing active workspace.
-- All three resolve to the identical value today (exactly one real
-- workspace exists), but the priority order is the documented, correct
-- behavior for whenever this backfill logic is ever re-read.
update public.projects p
set workspace_id = c.workspace_id
from public.clients c
where p.client_id = c.id
  and p.workspace_id is null;

update public.projects p
set workspace_id = q.workspace_id
from public.sales_quotes q
where p.source_sales_quote_id = q.id
  and p.workspace_id is null;

update public.projects
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- tasks: prefer the creator's own single active workspace membership,
-- then the single existing active workspace.
update public.tasks t
set workspace_id = wm.workspace_id
from public.workspace_members wm
where t.created_by = wm.user_id
  and t.workspace_id is null
  and (select count(*) from public.workspace_members wm2 where wm2.user_id = t.created_by) = 1;

update public.tasks
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- ============================================================
-- Section 4 -- In-migration assertion: abort the whole transaction if
-- the backfill missed anything.
-- ============================================================

do $$
begin
  if exists (select 1 from public.projects where workspace_id is null) then
    raise exception 'backfill incomplete: projects.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.tasks where workspace_id is null) then
    raise exception 'backfill incomplete: tasks.workspace_id still has nulls';
  end if;
end $$;

-- ============================================================
-- Section 5 -- Ownership triggers. Reuses guard_workspace_id_mutation()
-- (migration 117) verbatim -- it is table-agnostic (reads/writes
-- new.workspace_id generically via the NEW/OLD record, not hard-coded
-- to any specific table), already hardened (security definer,
-- search_path=''), and already proven correct in production for
-- clients/sales_quotes. No new trigger function is created by this
-- migration.
-- ============================================================

drop trigger if exists projects_guard_workspace_id on public.projects;
create trigger projects_guard_workspace_id
  before insert or update on public.projects
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists tasks_guard_workspace_id on public.tasks;
create trigger tasks_guard_workspace_id
  before insert or update on public.tasks
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 6 -- Enforce NOT NULL. Every existing row was just verified
-- non-null in Section 4, and every future write has been
-- trigger-protected since Section 5, both within this same transaction.
-- ============================================================

alter table public.projects alter column workspace_id set not null;
alter table public.tasks alter column workspace_id set not null;

commit;

-- ============================================================
-- Deliberately NOT done by this migration, matching migration 117's own
-- precedent exactly:
--   - No RLS policy on any table is touched. `tasks` keeps its existing
--     using(true)/with check(true) policies exactly as today. `projects`
--     keeps its existing SPLIT policy exactly as today too, confirmed by
--     direct read rather than assumed identical to tasks: `authenticated
--     read projects` is using(true), but its write policy was replaced
--     by migration 023 with `pm and admin write projects` --
--     using(is_app_admin(auth.uid()) or has_role('pm')), a role gate
--     unrelated to tenancy. This migration adds tamper-proof ownership
--     METADATA only, on top of whatever access rule already governs
--     each table -- not access containment, and not a role-gate change
--     of any kind. RLS/workspace tightening for this group is Stage 2's
--     next, separate migration.
--   - No child table (project_locations and the eleven others named in
--     this file's header) gets its own workspace_id column -- ownership
--     is inherited through the required FK, exactly like Group 1's
--     child tables.
-- ============================================================

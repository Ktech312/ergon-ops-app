-- Phase 2 of Ergon's productization tenant-isolation work (see
-- PRODUCT_PHASE2_PLAN.md, Revision 3 -- approved by E, final
-- implementation requirements applied). Adds real, database-enforced
-- ownership to the two root tables of the Clients + Sales Quote cluster.
--
-- Fully atomic: this single transaction adds the columns, backfills every
-- existing row to the Ergon Test Workspace, asserts the backfill left
-- zero nulls, installs the ownership-enforcement functions and triggers,
-- and enforces NOT NULL -- all in this one file, in this order, with no
-- nullable soak period at any point. If any step fails, the whole
-- transaction rolls back and nothing changes.
--
-- Every child table in this cluster (sales_quote_locations,
-- sales_quote_location_images, sales_quote_location_items,
-- sales_quote_bom_lines, sales_quote_intake_responses,
-- sales_quote_proposals) inherits ownership through its required,
-- cascading FK to sales_quotes and gets NO new column here -- see
-- PRODUCT_PHASE2_PLAN.md section 2.2 for the full per-table reasoning.
--
-- No RLS policy on any table is touched by this migration. clients and
-- sales_quotes keep their existing using(true)/with check(true) policies
-- exactly as they are today -- this migration adds tamper-proof ownership
-- METADATA, not cross-workspace access containment. That containment is
-- Phase 3's job, not this file's -- see PRODUCT_PHASE2_PLAN.md section
-- 8.1 for why those are two different guarantees.
--
-- Trigger-order note: sales_quotes already has a `before insert` trigger,
-- sales_quotes_assign_ref (migration 066), which alphabetically fires
-- BEFORE the new sales_quotes_guard_workspace_id trigger added below
-- ("sales_quotes_assign_ref" < "sales_quotes_guard_workspace_id"). This
-- does not matter for THIS migration -- assign_sales_quote_ref() in its
-- current (migration 066) form never reads new.workspace_id, only
-- new.quote_ref. It becomes relevant only when migration 118 redefines
-- assign_sales_quote_ref() to key the ref counter by workspace -- that
-- migration explicitly controls firing order at that time (see
-- PRODUCT_PHASE2_PLAN.md section 7.2). No trigger is renamed here.
--
-- Before running this migration: run the preflight block from
-- PRODUCT_PHASE2_PLAN.md against production and confirm the expected
-- results. Do not run this migration against Supabase until E has
-- reviewed this file and the accompanying preflight/verification/test/
-- rollback blocks.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, made NOT NULL later in this
-- same transaction (Section 6).
-- ============================================================

alter table public.clients
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.sales_quotes
  add column if not exists workspace_id uuid references public.workspaces(id);

-- ============================================================
-- Section 2 -- Indexes
-- ============================================================

create index if not exists idx_clients_workspace_id on public.clients(workspace_id);
create index if not exists idx_sales_quotes_workspace_id on public.sales_quotes(workspace_id);

-- ============================================================
-- Section 3 -- Backfill existing rows to the Ergon Test Workspace.
-- No trigger exists yet at this point in the transaction, so this plain
-- UPDATE cannot conflict with the ownership guard installed in Section 5.
-- Idempotent: matches zero rows (no-op) on any re-run.
-- ============================================================

update public.clients
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.sales_quotes
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- ============================================================
-- Section 4 -- In-migration assertion: abort the whole transaction if
-- the backfill missed anything, rather than trusting a separate manual
-- check run after the fact. This is the proof that "historical backfill
-- is complete" -- the migration physically cannot commit otherwise.
-- ============================================================

do $$
begin
  if exists (select 1 from public.clients where workspace_id is null) then
    raise exception 'backfill incomplete: clients.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.sales_quotes where workspace_id is null) then
    raise exception 'backfill incomplete: sales_quotes.workspace_id still has nulls';
  end if;
end $$;

-- ============================================================
-- Section 5 -- Ownership functions and triggers.
--
-- resolve_caller_workspace_id() -- security definer, set search_path = ''
-- (same hardened pattern as every function in migration 115). Requires
-- the caller to have exactly one ACTIVE workspace membership and
-- distinguishes three failure modes with three different messages: no
-- membership at all, membership exists but the workspace is suspended,
-- and ambiguous (more than one active membership -- a "primary
-- workspace" selector for multi-membership users does not exist yet, so
-- this fails loudly instead of guessing).
--
-- guard_workspace_id_mutation() -- security definer, set search_path =
-- ''. On INSERT: derives workspace_id server-side via
-- resolve_caller_workspace_id(), ignoring/overwriting anything the
-- client supplied. On UPDATE: UNCONDITIONALLY rejects any attempt to
-- change or null an existing workspace_id -- there is no bypass, escape
-- hatch, session-variable override, or admin exception of any kind in
-- this migration. A future workspace-reassignment capability requires
-- its own separately reviewed migration, its own authorization model,
-- and its own audit history -- not a flag hidden in this trigger.
--
-- Neither function is granted EXECUTE beyond the implicit owner
-- privilege. EXECUTE is explicitly revoked from PUBLIC on both, and NOT
-- granted to `authenticated`:
--   - guard_workspace_id_mutation() is a trigger function (returns
--     trigger). Postgres does not permit calling a trigger-type function
--     directly via SQL at all -- attempting `select
--     guard_workspace_id_mutation()` fails with "trigger functions can
--     only be called as triggers" -- and trigger invocation itself is
--     performed by the executor as part of processing the table's
--     defined trigger, not as an ACL-checked function call by the
--     DML-issuing role. No EXECUTE grant to `authenticated` is needed
--     for the trigger to fire on an authenticated user's insert/update.
--   - resolve_caller_workspace_id() is only ever called from within
--     guard_workspace_id_mutation()'s own security-definer body. Because
--     that outer function is SECURITY DEFINER, the inner call executes
--     under the DEFINER's (the migration-running role's) privileges, not
--     the original authenticated caller's -- so the definer's own
--     execute rights satisfy the inner call without any grant to
--     `authenticated`.
-- The transaction-safe test script accompanying this migration verifies
-- this empirically: an authenticated test insert must still get its
-- workspace_id stamped correctly with no EXECUTE grant to `authenticated`
-- on either function. If that test ever fails against a real
-- Supabase/Postgres version, the minimal fix is
-- `grant execute on function public.resolve_caller_workspace_id() to
-- authenticated;` only -- guard_workspace_id_mutation() itself should
-- never need a grant, since it cannot be invoked directly by any role
-- regardless of trigger context.
-- ============================================================

create or replace function public.resolve_caller_workspace_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_membership_count int;
  active_membership_count int;
  result uuid;
begin
  select count(*) into total_membership_count
  from public.workspace_members
  where user_id = auth.uid();

  if total_membership_count = 0 then
    raise exception 'no workspace membership found for current user';
  end if;

  select count(*) into active_membership_count
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  if active_membership_count = 0 then
    raise exception 'workspace membership exists but the workspace is not active (suspended)';
  elsif active_membership_count > 1 then
    raise exception 'ambiguous active workspace membership for current user -- primary workspace selection is not yet implemented';
  end if;

  select wm.workspace_id into result
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  return result;
end;
$$;

revoke all on function public.resolve_caller_workspace_id() from public;

create or replace function public.guard_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := public.resolve_caller_workspace_id();
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_workspace_id_mutation() from public;

drop trigger if exists clients_guard_workspace_id on public.clients;
create trigger clients_guard_workspace_id
  before insert or update on public.clients
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists sales_quotes_guard_workspace_id on public.sales_quotes;
create trigger sales_quotes_guard_workspace_id
  before insert or update on public.sales_quotes
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 6 -- Enforce NOT NULL. Every existing row was just verified
-- non-null in Section 4, and every future write has been
-- trigger-protected since Section 5, both within this same transaction
-- -- so there is no window to wait out before enforcing this. clients
-- and sales_quotes are small operational tables (the same scale as the
-- tables migration 115 modified), so the validating table scan this
-- performs is fast and safe to run inline; there is no need for the
-- two-step "check ... not valid" + "validate constraint" pattern reserved
-- for tables large enough that a full-table lock would be a real
-- concern.
-- ============================================================

alter table public.clients alter column workspace_id set not null;
alter table public.sales_quotes alter column workspace_id set not null;

commit;

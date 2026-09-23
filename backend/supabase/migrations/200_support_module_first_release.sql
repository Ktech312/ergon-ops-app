-- Migration 200: Support/Service module, first release (decision D13).
-- Design doc: PRODUCT_SUPPORT_MODULE_DESIGN.md (Queue B7) -- revalidated
-- against the CURRENT schema before writing this (2026-09-23), not
-- implemented verbatim from that doc's own illustrative §3 schema, which
-- predates Phase 3's workspace-scoping work and has since drifted in two
-- concrete ways, corrected here:
--   1. `installed_assets` has NO own `workspace_id` column (confirmed:
--      migration 089 created it, migration 157 scoped its RLS by
--      DERIVING the workspace through `project_owner_workspace_id(project_id)`,
--      never adding a column) -- `support_cases`/`support_case_activity`
--      follow the same derived-workspace pattern for the same reason
--      (`support_case_activity` is a pure child of `support_cases`, no
--      benefit to a redundant column), while `support_cases` ITSELF gets
--      a real, own `workspace_id` column matching the `projects`/
--      `sales_quotes` root-table pattern instead, since first-release
--      scope explicitly requires listing/filtering cases directly (§7 of
--      the design doc, and E's own numbered spec) -- a derived-only
--      table would need an inefficient join on every list query.
--   2. The design doc's illustrative `support_case_activity.inventory_item_ref
--      text references inventory_items(ref)` does not exist --
--      `inventory_items` has no `ref` column at all (confirmed by direct
--      read of migration 001); real linkage uses `inventory_item_id uuid
--      references inventory_items(id)`, the table's actual primary key.
--
-- Parts/labor scope, confirmed deliberately narrow for this release: this
-- migration's `parts_used` activity kind is a LOG entry only (what was
-- used, on which case) -- it does NOT itself move real inventory. Real
-- stock deduction stays exactly where it already lives (client-driven,
-- `saveInventoryMovements`/`recordMovements` in main.tsx/persistence.ts,
-- writing to `inventory_movements`/`inventory_balances`) -- reusing that
-- existing, already-correct write path from the frontend (same discipline
-- as a normal Transfer to Project) rather than re-deriving inventory
-- balance math inside a new SQL function, exactly as the design doc's §5
-- instructs ("not a new deduction mechanism"). Labor stays a plain
-- numeric note field on the same activity row, not a separate timesheet.
--
-- Explicitly OUT of scope for this migration/release (unchanged from the
-- design doc's own §6, and E's own standing boundaries): SLA enforcement
-- (only a visibility flag via `sla_due_at`, no auto-escalation/auto-
-- notification), any client-facing portal/share-link, and a specific SLA
-- matrix (priority -> target hours) -- all deferred, not decided here.

begin;

-- ============================================================
-- Section 1 -- support_cases. Root table, own workspace_id (matches
-- projects/sales_quotes), stamped server-side via resolve_caller_workspace_id()
-- in the same trigger that generates case_number -- never client-supplied,
-- and cross-checked against the caller-supplied project_id's OWN workspace
-- (project_owner_workspace_id(new.project_id)) so a caller can never
-- create a case against a project belonging to a different workspace,
-- even though RLS's own with-check only verifies membership in
-- new.workspace_id itself, not that project_id agrees with it -- this is
-- exactly the class of cross-entity containment gap this schema's own
-- history (migration 155's review of the proposal RPCs) has already
-- found and fixed elsewhere; closed here from the start instead of
-- needing a later corrective migration.
-- ============================================================

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  case_number text not null,
  project_id uuid not null references public.projects(id),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_on_client', 'resolved', 'reopened', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- Visibility only this release -- see this file's own header and the
  -- design doc's §6/§4: no enforcement action of any kind reads this.
  sla_due_at timestamptz,
  owner_workspace_member_id uuid references public.workspace_members(id),
  summary text not null check (char_length(btrim(summary)) > 0),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (workspace_id, case_number)
);

create index if not exists idx_support_cases_workspace_id on public.support_cases(workspace_id);
create index if not exists idx_support_cases_project_id on public.support_cases(project_id);
create index if not exists idx_support_cases_status on public.support_cases(workspace_id, status);
create index if not exists idx_support_cases_owner on public.support_cases(owner_workspace_member_id);

create table if not exists public.support_case_ref_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year integer not null,
  next_seq integer not null default 1,
  primary key (workspace_id, year)
);

alter table public.support_case_ref_counters enable row level security;

create policy "workspace members read support_case_ref_counters"
  on public.support_case_ref_counters for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- No direct client write policy at all -- the only writer is
-- assign_support_case_ref() below, a SECURITY DEFINER trigger function
-- that bypasses RLS by definition (same posture as every other
-- <entity>_ref_counters table in this schema, e.g. sales_quote_ref_counters).

create or replace function public.assign_support_case_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_project_workspace_id uuid;
  ref_year integer := extract(year from pg_catalog.now())::integer;
  seq integer;
begin
  v_workspace_id := public.resolve_caller_workspace_id();

  v_project_workspace_id := (select workspace_id from public.projects where id = new.project_id);
  if v_project_workspace_id is null then
    raise exception 'The selected project was not found.';
  end if;
  if v_project_workspace_id <> v_workspace_id then
    raise exception 'That project does not belong to your workspace.';
  end if;

  new.workspace_id := v_workspace_id;

  if new.case_number is null then
    insert into public.support_case_ref_counters as scrc (workspace_id, year, next_seq)
    values (v_workspace_id, ref_year, 2)
    on conflict (workspace_id, year) do update set next_seq = scrc.next_seq + 1
    returning next_seq - 1 into seq;

    new.case_number := 'SC-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.assign_support_case_ref() from public;

drop trigger if exists support_cases_assign_ref on public.support_cases;
create trigger support_cases_assign_ref
  before insert on public.support_cases
  for each row execute function public.assign_support_case_ref();

create or replace function public.touch_support_case_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists support_cases_touch_updated_at on public.support_cases;
create trigger support_cases_touch_updated_at
  before update on public.support_cases
  for each row execute function public.touch_support_case_updated_at();

-- workspace_id is set once, server-side, at insert time (the trigger
-- above) -- never mutable afterward. A self-referencing subquery inside
-- an UPDATE policy's with-check (comparing the proposed row back against
-- the same table) is fragile MVCC territory in Postgres -- this schema's
-- own established, proven-safe way to make one column immutable is a
-- dedicated trigger (guard_channel_workspace_id_mutation, migration 162,
-- redefined by 195), so that pattern is reused here instead of inventing
-- a second approach.

create or replace function public.guard_support_case_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id then
    raise exception 'workspace_id cannot be changed on an existing support case';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_support_case_workspace_id_mutation() from public;

drop trigger if exists support_cases_guard_workspace_id on public.support_cases;
create trigger support_cases_guard_workspace_id
  before update on public.support_cases
  for each row execute function public.guard_support_case_workspace_id_mutation();

alter table public.support_cases enable row level security;

create policy "workspace members read support_cases"
  on public.support_cases for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert support_cases"
  on public.support_cases for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update support_cases"
  on public.support_cases for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- No delete policy -- a support case is never hard-deleted, only moved to
-- 'closed'. Matches this schema's own established discipline for core
-- lifecycle entities with no delete path (e.g. sales_quotes, projects).

-- ============================================================
-- Section 2 -- support_case_assets. Junction table, no own workspace_id
-- (pure child of support_cases, same reasoning as installed_assets
-- itself). The INSERT with-check additionally confirms the linked
-- installed_asset actually belongs to the SAME workspace as the case
-- (via its own project) -- the same cross-entity containment discipline
-- as Section 1's project_id check.
-- ============================================================

create or replace function public.support_case_owner_workspace_id(p_support_case_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.support_cases where id = p_support_case_id;
$$;

revoke all on function public.support_case_owner_workspace_id(uuid) from public;
revoke execute on function public.support_case_owner_workspace_id(uuid) from anon;
grant execute on function public.support_case_owner_workspace_id(uuid) to authenticated;

create table if not exists public.support_case_assets (
  support_case_id uuid not null references public.support_cases(id) on delete cascade,
  installed_asset_id uuid not null references public.installed_assets(id),
  created_at timestamptz not null default now(),
  primary key (support_case_id, installed_asset_id)
);

create index if not exists idx_support_case_assets_case on public.support_case_assets(support_case_id);

alter table public.support_case_assets enable row level security;

create policy "workspace members read support_case_assets"
  on public.support_case_assets for select to authenticated
  using (public.is_workspace_member(public.support_case_owner_workspace_id(support_case_id)));

create policy "workspace members insert support_case_assets"
  on public.support_case_assets for insert to authenticated
  with check (
    public.is_active_workspace_member(public.support_case_owner_workspace_id(support_case_id))
    and public.support_case_owner_workspace_id(support_case_id) = public.project_owner_workspace_id(
      (select ia.project_id from public.installed_assets ia where ia.id = installed_asset_id)
    )
  );

create policy "workspace members delete support_case_assets"
  on public.support_case_assets for delete to authenticated
  using (public.is_active_workspace_member(public.support_case_owner_workspace_id(support_case_id)));

-- ============================================================
-- Section 3 -- support_case_activity. Append-only timeline, same
-- SELECT+INSERT-only shape as task_activity_log (migration 157) -- no
-- update/delete policy at all, by design.
-- ============================================================

create table if not exists public.support_case_activity (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases(id) on delete cascade,
  kind text not null check (kind in (
    'note', 'status_change', 'client_communication', 'scheduled_visit', 'parts_used', 'reopened'
  )),
  body text,
  actor_email text not null,
  occurred_at timestamptz not null default now(),
  previous_status text,
  new_status text,
  -- Log-only reference, see this file's own header -- never itself moves
  -- inventory.
  inventory_item_id uuid references public.inventory_items(id),
  qty numeric(10, 2),
  created_at timestamptz not null default now()
);

create index if not exists idx_support_case_activity_case on public.support_case_activity(support_case_id, occurred_at desc);

alter table public.support_case_activity enable row level security;

create policy "workspace members read support_case_activity"
  on public.support_case_activity for select to authenticated
  using (public.is_workspace_member(public.support_case_owner_workspace_id(support_case_id)));

-- Direct client INSERT is intentionally impossible -- every activity row
-- (including plain notes) is written through add_support_case_activity()/
-- change_support_case_status()/reopen_support_case() below, all SECURITY
-- DEFINER, so actor_email is always the real caller's own address, never
-- client-supplied. No insert policy exists for `authenticated` at all.

-- ============================================================
-- Section 4 -- create_support_case(). Entry point from a closed Project /
-- Client Ledger record (design doc §2) -- requires the target project to
-- already be added to the ledger, matching "not from scratch, and not
-- from an open/in-progress project."
-- ============================================================

create or replace function public.create_support_case(
  p_project_id uuid,
  p_summary text,
  p_priority text default 'normal',
  p_owner_workspace_member_id uuid default null,
  p_installed_asset_ids uuid[] default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_workspace_id uuid;
  v_project_added_to_ledger boolean;
  v_case public.support_cases;
  v_asset_id uuid;
  v_asset_project_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to create a support case';
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  if p_summary is null or char_length(btrim(p_summary)) = 0 then
    raise exception 'A summary is required to create a support case';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority: %', p_priority;
  end if;

  select added_to_ledger into v_project_added_to_ledger from public.projects where id = p_project_id;
  if v_project_added_to_ledger is null then
    raise exception 'Project not found';
  end if;
  if not v_project_added_to_ledger then
    raise exception 'Support cases can only be created from a project already added to the Client Ledger';
  end if;

  if p_owner_workspace_member_id is not null then
    if not exists (select 1 from public.workspace_members where id = p_owner_workspace_member_id) then
      raise exception 'Owner not found';
    end if;
  end if;

  insert into public.support_cases (project_id, summary, priority, owner_workspace_member_id, created_by_email)
  values (p_project_id, btrim(p_summary), p_priority, p_owner_workspace_member_id, v_actor_email)
  returning * into v_case;

  v_workspace_id := v_case.workspace_id;

  if p_installed_asset_ids is not null then
    foreach v_asset_id in array p_installed_asset_ids loop
      select project_id into v_asset_project_id from public.installed_assets where id = v_asset_id;
      if v_asset_project_id is null then
        raise exception 'Installed asset not found: %', v_asset_id;
      end if;
      if v_asset_project_id <> p_project_id then
        raise exception 'Installed asset % does not belong to the selected project', v_asset_id;
      end if;
      insert into public.support_case_assets (support_case_id, installed_asset_id)
      values (v_case.id, v_asset_id)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.support_case_activity (support_case_id, kind, body, actor_email, new_status)
  values (v_case.id, 'status_change', 'Case opened.', v_actor_email, 'open');

  return v_case;
end;
$$;

revoke all on function public.create_support_case(uuid, text, text, uuid, uuid[]) from public;
revoke execute on function public.create_support_case(uuid, text, text, uuid, uuid[]) from anon;
grant execute on function public.create_support_case(uuid, text, text, uuid, uuid[]) to authenticated;

-- ============================================================
-- Section 5 -- add_support_case_activity(). Handles every activity kind
-- EXCEPT status_change/reopened, which have their own dedicated functions
-- below since both mutate the parent case's status atomically -- keeping
-- them separate rather than one do-everything function makes the two
-- genuinely different write shapes (plain log row vs. row + parent
-- status flip) impossible to confuse at the call site.
-- ============================================================

create or replace function public.add_support_case_activity(
  p_support_case_id uuid,
  p_kind text,
  p_body text,
  p_occurred_at timestamptz default null,
  p_inventory_item_id uuid default null,
  p_qty numeric default null
)
returns public.support_case_activity
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_case_workspace_id uuid;
  v_row public.support_case_activity;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to log support case activity';
  end if;
  if p_kind not in ('note', 'client_communication', 'scheduled_visit', 'parts_used') then
    raise exception 'Use change_support_case_status()/reopen_support_case() for status transitions, not add_support_case_activity()';
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  select workspace_id into v_case_workspace_id from public.support_cases where id = p_support_case_id;
  if v_case_workspace_id is null then
    raise exception 'Support case not found';
  end if;
  if not public.is_active_workspace_member(v_case_workspace_id) then
    raise exception 'Not an active member of this case''s workspace';
  end if;

  if p_kind = 'parts_used' then
    if p_inventory_item_id is null or p_qty is null or p_qty <= 0 then
      raise exception 'parts_used requires an inventory item and a positive quantity';
    end if;
    if (select workspace_id from public.inventory_items where id = p_inventory_item_id) <> v_case_workspace_id then
      raise exception 'That inventory item does not belong to this case''s workspace';
    end if;
  elsif p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception '% requires a non-empty note', p_kind;
  end if;

  insert into public.support_case_activity (support_case_id, kind, body, actor_email, occurred_at, inventory_item_id, qty)
  values (p_support_case_id, p_kind, nullif(btrim(coalesce(p_body, '')), ''), v_actor_email, coalesce(p_occurred_at, now()), p_inventory_item_id, p_qty)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_support_case_activity(uuid, text, text, timestamptz, uuid, numeric) from public;
revoke execute on function public.add_support_case_activity(uuid, text, text, timestamptz, uuid, numeric) from anon;
grant execute on function public.add_support_case_activity(uuid, text, text, timestamptz, uuid, numeric) to authenticated;

-- ============================================================
-- Section 6 -- change_support_case_status(). A real, small state
-- machine, not a free-form flip -- 'reopened' is reachable ONLY through
-- reopen_support_case() below, never through this function, so "a case
-- was reopened" is always a distinct, auditable transition (design doc
-- §5) rather than something that could also happen silently here.
-- ============================================================

create or replace function public.change_support_case_status(
  p_support_case_id uuid,
  p_new_status text,
  p_note text default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_case public.support_cases;
  v_previous_status text;
  v_allowed boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to change a support case''s status';
  end if;
  if p_new_status not in ('open', 'in_progress', 'waiting_on_client', 'resolved', 'closed') then
    raise exception 'Invalid target status: % (use reopen_support_case() to reach reopened)', p_new_status;
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  select * into v_case from public.support_cases where id = p_support_case_id for update;
  if v_case.id is null then
    raise exception 'Support case not found';
  end if;
  if not public.is_active_workspace_member(v_case.workspace_id) then
    raise exception 'Not an active member of this case''s workspace';
  end if;

  if p_new_status = v_case.status then
    raise exception 'Support case is already %', p_new_status;
  end if;

  -- Active states bounce freely among each other and can move to
  -- resolved. resolved/reopened can only move to closed from here --
  -- going back to an active state from resolved/closed requires
  -- reopen_support_case() instead.
  if v_case.status in ('open', 'in_progress', 'waiting_on_client') then
    v_allowed := p_new_status in ('open', 'in_progress', 'waiting_on_client', 'resolved');
  elsif v_case.status in ('resolved', 'reopened') then
    v_allowed := p_new_status = 'closed';
  end if;

  if not v_allowed then
    raise exception 'Cannot move a % case to %', v_case.status, p_new_status;
  end if;

  v_previous_status := v_case.status;

  update public.support_cases
  set status = p_new_status,
      resolved_at = case when p_new_status = 'resolved' then now() else resolved_at end,
      closed_at = case when p_new_status = 'closed' then now() else closed_at end
  where id = p_support_case_id
  returning * into v_case;

  insert into public.support_case_activity (support_case_id, kind, body, actor_email, previous_status, new_status)
  values (p_support_case_id, 'status_change', nullif(btrim(coalesce(p_note, '')), ''), v_actor_email, v_previous_status, p_new_status);

  return v_case;
end;
$$;

revoke all on function public.change_support_case_status(uuid, text, text) from public;
revoke execute on function public.change_support_case_status(uuid, text, text) from anon;
grant execute on function public.change_support_case_status(uuid, text, text) to authenticated;

-- ============================================================
-- Section 7 -- reopen_support_case(). Only valid from resolved/closed ->
-- reopened. Distinct from change_support_case_status() entirely (see
-- Section 6's own comment).
-- ============================================================

create or replace function public.reopen_support_case(
  p_support_case_id uuid,
  p_note text default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_case public.support_cases;
  v_previous_status text;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to reopen a support case';
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  select * into v_case from public.support_cases where id = p_support_case_id for update;
  if v_case.id is null then
    raise exception 'Support case not found';
  end if;
  if not public.is_active_workspace_member(v_case.workspace_id) then
    raise exception 'Not an active member of this case''s workspace';
  end if;
  if v_case.status not in ('resolved', 'closed') then
    raise exception 'Only a resolved or closed case can be reopened (current status: %)', v_case.status;
  end if;

  v_previous_status := v_case.status;

  update public.support_cases
  set status = 'reopened'
  where id = p_support_case_id
  returning * into v_case;

  insert into public.support_case_activity (support_case_id, kind, body, actor_email, previous_status, new_status)
  values (p_support_case_id, 'reopened', nullif(btrim(coalesce(p_note, '')), ''), v_actor_email, v_previous_status, 'reopened');

  return v_case;
end;
$$;

revoke all on function public.reopen_support_case(uuid, text) from public;
revoke execute on function public.reopen_support_case(uuid, text) from anon;
grant execute on function public.reopen_support_case(uuid, text) to authenticated;

-- ============================================================
-- Section 8 -- assign_support_case_owner(). Reassignment, separate from
-- create_support_case's own initial assignment -- the frontend fires a
-- support_case_assigned notification after this succeeds (client-side,
-- same convention as every other *_assigned event in this schema, e.g.
-- task_assigned -- notification triggering has never lived inside a
-- write RPC itself in this codebase).
-- ============================================================

create or replace function public.assign_support_case_owner(
  p_support_case_id uuid,
  p_owner_workspace_member_id uuid
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_case public.support_cases;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to reassign a support case';
  end if;

  select * into v_case from public.support_cases where id = p_support_case_id for update;
  if v_case.id is null then
    raise exception 'Support case not found';
  end if;
  if not public.is_active_workspace_member(v_case.workspace_id) then
    raise exception 'Not an active member of this case''s workspace';
  end if;
  if p_owner_workspace_member_id is not null and not exists (
    select 1 from public.workspace_members where id = p_owner_workspace_member_id and workspace_id = v_case.workspace_id
  ) then
    raise exception 'Owner not found in this workspace';
  end if;

  update public.support_cases
  set owner_workspace_member_id = p_owner_workspace_member_id
  where id = p_support_case_id
  returning * into v_case;

  return v_case;
end;
$$;

revoke all on function public.assign_support_case_owner(uuid, uuid) from public;
revoke execute on function public.assign_support_case_owner(uuid, uuid) from anon;
grant execute on function public.assign_support_case_owner(uuid, uuid) to authenticated;

-- ============================================================
-- Section 9 -- notification_rules: register support_case_assigned so the
-- existing per-event channel-routing UI (Admin -> Notification Rules)
-- can toggle it like every other event, matching this schema's own
-- established list-widening pattern (migration 149's own header comment
-- documents the live list this drops-and-recreates from).
-- ============================================================

alter table public.notification_rules drop constraint if exists notification_rules_event_type_check;
alter table public.notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'build_stage_changed', 'catalog_price_change_requested', 'catalog_price_change_reviewed',
    'direct_message_received', 'low_stock_reached', 'mentioned',
    'purchase_request_status_changed', 'quote_proposal_responded', 'submittal_responded',
    'task_assigned', 'task_overdue', 'task_status_changed', 'user_signup_pending',
    'proposal_question_received', 'support_case_assigned'
  ));

commit;

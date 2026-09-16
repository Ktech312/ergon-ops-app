-- System Health Phase B (Queue B4/R1, PRODUCT_SYSTEM_HEALTH_PLAN.md):
-- durable, admin-visible event storage for cron/RPC/API/backup-restore
-- failures beyond what Phase A's existing notification_deliveries-derived
-- view already covers. Implements the design doc's §2 schema, §3
-- dedup/lifecycle rule, §6 retention tiering, and §11 steps 1 and 4
-- exactly as specified there -- nothing here introduces a new decision.
--
-- §9 of the design doc names exactly one genuinely open item: which
-- channel/recipient fires an admin alert on a `down` transition (D8).
-- This migration does NOT wire any alert -- it only builds the durable
-- storage, dedup upsert, and admin lifecycle actions (§11 steps 1/4).
-- Steps 2 (additional recordSystemHealthEvent call sites beyond the one
-- wired this pass) and 5 (alert wiring) are deliberately left for a
-- later, explicitly-scoped pass -- see PRODUCT_MASTER_COMPLETION_PLAN.md
-- Queue R1 item 1 for what's wired now vs. queued next.
--
-- Confirm 151 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- 1. system_health_events -- one row per distinct, currently-unresolved
--    (surface, entity_type, entity_id, failure_reason_code) key; repeat
--    occurrences increment in place (§3). workspace_id is nullable
--    (null = infrastructure-wide event) -- independent of Phase 3 RLS,
--    matching every other temporary single-workspace-posture table in
--    this app; every row is visible to any admin today.
-- ============================================================

create table if not exists public.system_health_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  surface text not null,
  entity_type text,
  entity_id uuid,
  failure_reason_code text not null,
  severity text not null check (severity in ('info', 'degraded', 'down')),
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  occurrence_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_by_email text,
  previous_occurrence_id uuid references public.system_health_events(id) on delete set null,
  safe_detail jsonb,
  created_at timestamptz not null default now()
);

-- Partial unique index: only an active/acknowledged row can be a dedup
-- target. A resolved row's repeat failure never reopens it -- it always
-- inserts a fresh row (linked via previous_occurrence_id in the RPC
-- below), which is exactly why this index excludes 'resolved' rows.
create unique index if not exists system_health_events_dedup_key
  on public.system_health_events (
    surface,
    (coalesce(entity_type, '')),
    (coalesce(entity_id, '00000000-0000-0000-0000-000000000000')),
    failure_reason_code
  )
  where status in ('active', 'acknowledged');

create index if not exists idx_system_health_events_status on public.system_health_events(status);
create index if not exists idx_system_health_events_surface on public.system_health_events(surface);

alter table public.system_health_events enable row level security;

create policy "admin read system_health_events"
  on public.system_health_events for select to authenticated
  using (public.is_app_admin(auth.uid()));

-- Zero write policies -- every write goes through the RPCs below,
-- matching this repo's own "close direct-write bypasses from day one"
-- discipline (Queue C2.7, applied proactively in migrations 147-149).
revoke all on table public.system_health_events from public, anon, authenticated;
grant select on table public.system_health_events to authenticated;

-- ============================================================
-- 2. Monthly summary tier (§6 retention): a resolved row keeps full
--    detail for 90 days after resolved_at, then rolls up into one row
--    per (surface, failure_reason_code, month) here -- retained
--    indefinitely at summary level, never deleted. active/acknowledged
--    rows are never touched by retention regardless of age.
-- ============================================================

create table if not exists public.system_health_events_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  surface text not null,
  failure_reason_code text not null,
  summary_month date not null,
  occurrence_count int not null default 0,
  updated_at timestamptz not null default now(),
  unique (surface, failure_reason_code, summary_month)
);

alter table public.system_health_events_monthly_summary enable row level security;

create policy "admin read system_health_events_monthly_summary"
  on public.system_health_events_monthly_summary for select to authenticated
  using (public.is_app_admin(auth.uid()));

revoke all on table public.system_health_events_monthly_summary from public, anon, authenticated;
grant select on table public.system_health_events_monthly_summary to authenticated;

-- ============================================================
-- 3. record_system_health_event -- the one dedicated write path (§3
--    self-monitoring rule: never routed through recordNotificationDelivery
--    or any other monitored path). Callable by any authenticated caller
--    (a real business-logic RPC recording its own failure) -- not
--    restricted to admin, since the thing reporting a failure is rarely
--    an admin session; read access stays admin-only via RLS above.
--    Input validation still raises (a genuine caller bug, same EC001
--    convention as every other RPC in this repo) but the dedup upsert
--    itself is wrapped so an unexpected failure of the health-logging
--    write can never propagate into the real operation that triggered
--    it (§10: "the write helper itself never throws to its caller").
-- ============================================================

create or replace function public.record_system_health_event(
  p_surface text,
  p_entity_type text,
  p_entity_id uuid,
  p_failure_reason_code text,
  p_severity text,
  p_safe_detail jsonb default null,
  p_workspace_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_previous_resolved_id uuid;
begin
  if p_surface is null or char_length(btrim(p_surface)) = 0 then
    raise exception 'surface is required.' using errcode = 'EC001';
  end if;
  if p_failure_reason_code is null or char_length(btrim(p_failure_reason_code)) = 0 then
    raise exception 'failure_reason_code is required.' using errcode = 'EC001';
  end if;
  if p_severity not in ('info', 'degraded', 'down') then
    raise exception 'severity must be info, degraded, or down.' using errcode = 'EC001';
  end if;

  begin
    select she.id into v_previous_resolved_id
      from public.system_health_events as she
      where she.surface = p_surface
        and coalesce(she.entity_type, '') = coalesce(p_entity_type, '')
        and coalesce(she.entity_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_entity_id, '00000000-0000-0000-0000-000000000000')
        and she.failure_reason_code = p_failure_reason_code
        and she.status = 'resolved'
      order by she.resolved_at desc nulls last, she.created_at desc
      limit 1;

    insert into public.system_health_events as she (
      workspace_id, surface, entity_type, entity_id, failure_reason_code,
      severity, safe_detail, previous_occurrence_id
    ) values (
      p_workspace_id, p_surface, p_entity_type, p_entity_id, p_failure_reason_code,
      p_severity, p_safe_detail, v_previous_resolved_id
    )
    on conflict (
      surface, (coalesce(entity_type, '')), (coalesce(entity_id, '00000000-0000-0000-0000-000000000000')), failure_reason_code
    ) where status in ('active', 'acknowledged')
    do update set
      occurrence_count = she.occurrence_count + 1,
      last_seen_at = now(),
      safe_detail = coalesce(excluded.safe_detail, she.safe_detail)
    returning she.id into v_event_id;
  exception when others then
    -- §10: a failed health-event write must never break the real
    -- operation that triggered it. This is the one deliberate exception
    -- to "every failure gets a durable record" -- an insert-failure-
    -- into-the-failure-table has no safe place left to go; the caller
    -- gets null back instead of an exception.
    v_event_id := null;
  end;

  return v_event_id;
end;
$$;

revoke all on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) from public;
revoke execute on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) from anon;
grant execute on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) to authenticated;

-- ============================================================
-- 4. Admin lifecycle actions (§11 step 1).
-- ============================================================

create or replace function public.acknowledge_system_health_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
begin
  if not public.is_app_admin(v_actor_id) then
    raise exception 'Only an admin may acknowledge a System Health event.' using errcode = 'EC001';
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  update public.system_health_events as she
    set status = 'acknowledged', acknowledged_by_email = v_actor_email
    where she.id = p_event_id and she.status = 'active';

  if not found then
    raise exception 'This event could not be found or is not currently active.' using errcode = 'EC003';
  end if;
end;
$$;

revoke all on function public.acknowledge_system_health_event(uuid) from public;
revoke execute on function public.acknowledge_system_health_event(uuid) from anon;
grant execute on function public.acknowledge_system_health_event(uuid) to authenticated;

create or replace function public.resolve_system_health_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if not public.is_app_admin(v_actor_id) then
    raise exception 'Only an admin may resolve a System Health event.' using errcode = 'EC001';
  end if;

  update public.system_health_events as she
    set status = 'resolved', resolved_at = now()
    where she.id = p_event_id and she.status in ('active', 'acknowledged');

  if not found then
    raise exception 'This event could not be found or is not currently active/acknowledged.' using errcode = 'EC003';
  end if;
end;
$$;

revoke all on function public.resolve_system_health_event(uuid) from public;
revoke execute on function public.resolve_system_health_event(uuid) from anon;
grant execute on function public.resolve_system_health_event(uuid) to authenticated;

-- ============================================================
-- 5. Retention rollup (§11 step 4, called by api/cron/system-health-
--    retention.js using the service-role key -- not user-callable).
--    Rolls resolved rows older than 90 days into the monthly summary
--    tier, then deletes the rolled-up detail rows. active/acknowledged
--    rows of any age are never touched (the WHERE clause excludes them
--    unconditionally). Idempotent: running it twice in a row against the
--    same already-rolled-up rows finds nothing left to roll (they were
--    deleted the first time), so it is safe to retry on a failure
--    without double-counting the summary tier.
-- ============================================================

create or replace function public.roll_up_system_health_events(p_older_than timestamptz default now() - interval '90 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rolled_count integer;
begin
  with rolled as (
    select surface, failure_reason_code, date_trunc('month', resolved_at)::date as summary_month, count(*) as occurrence_count
    from public.system_health_events
    where status = 'resolved' and resolved_at is not null and resolved_at < p_older_than
    group by surface, failure_reason_code, date_trunc('month', resolved_at)::date
  ),
  upserted as (
    insert into public.system_health_events_monthly_summary as s (surface, failure_reason_code, summary_month, occurrence_count)
    select surface, failure_reason_code, summary_month, occurrence_count from rolled
    on conflict (surface, failure_reason_code, summary_month)
    do update set occurrence_count = s.occurrence_count + excluded.occurrence_count, updated_at = now()
    returning 1
  )
  select count(*) into v_rolled_count from upserted;

  delete from public.system_health_events
    where status = 'resolved' and resolved_at is not null and resolved_at < p_older_than;

  return v_rolled_count;
end;
$$;

-- Not granted to authenticated/anon at all -- called only via the
-- service-role key from the retention cron route, matching how every
-- other service-role-only server operation in this app works (no
-- signed-in "actor" for a scheduled job, same as api/cron/task-overdue).
revoke all on function public.roll_up_system_health_events(timestamptz) from public, anon, authenticated;

commit;

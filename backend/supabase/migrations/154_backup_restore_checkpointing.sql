-- Backup restore: resumable, per-section checkpointing (D9 approved
-- 2026-09-16; PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md reconciled
-- against E's exact spec and against migration 153's own required-vs-
-- optional split, which shipped just before this one). Per E's decision:
-- "implement resumable, per-section checkpointing. Unresolved optional
-- references produce visible warnings and can be retried; required-data
-- failures stop that section. Never report full success while a section
-- failed or was skipped."
--
-- The required-vs-optional distinction itself was already built
-- (persistence.ts's restoreMode parameter, `a889b60`) -- this migration
-- is purely the DURABLE TRACKING layer: a restore that's interrupted
-- (browser closed, network drop) or ends completed_with_failures can be
-- resumed without re-running sections that already succeeded.
--
-- Schema follows PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md §2/§3 almost
-- exactly, with one addition: restore_run_sections gains `warnings
-- text[]`, since a section can now succeed WITH warnings (an unresolved
-- optional reference) -- the spec's original 'succeeded'/'failed'/
-- 'skipped_empty' status vocabulary didn't need to distinguish this
-- before migration 153 existed.
--
-- Admin-only, matching the spec's own §2 note ("restore is an admin-only
-- action already implicit in handleImportBackup being reachable only
-- from an admin-gated screen") -- explicit RLS here rather than relying
-- on that implicit UI gate alone.
--
-- Confirm 154 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

create table if not exists public.restore_runs (
  id uuid primary key default gen_random_uuid(),
  -- A hash of the uploaded file's own bytes (SHA-256 hex, computed
  -- client-side via the Web Crypto API before this run is created) --
  -- two uploads of the exact same backup file resolve to the same run
  -- identity for resume to mean anything; a user-typed label could
  -- collide or drift from the actual file contents.
  snapshot_hash text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_failures', 'cancelled')),
  started_by_email text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_restore_runs_hash_started on public.restore_runs(snapshot_hash, started_at desc);

alter table public.restore_runs enable row level security;

create policy "admin read restore_runs"
  on public.restore_runs for select to authenticated
  using (public.is_app_admin(auth.uid()));

revoke all on table public.restore_runs from public, anon, authenticated;
grant select on table public.restore_runs to authenticated;

create table if not exists public.restore_run_sections (
  id uuid primary key default gen_random_uuid(),
  restore_run_id uuid not null references public.restore_runs(id) on delete cascade,
  section text not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'skipped_empty')),
  attempted_count int not null default 0,
  succeeded_count int not null default 0,
  error text,
  warnings text[],
  updated_at timestamptz not null default now(),
  unique (restore_run_id, section)
);

alter table public.restore_run_sections enable row level security;

create policy "admin read restore_run_sections"
  on public.restore_run_sections for select to authenticated
  using (public.is_app_admin(auth.uid()));

revoke all on table public.restore_run_sections from public, anon, authenticated;
grant select on table public.restore_run_sections to authenticated;

-- ============================================================
-- start_or_resume_restore_run: looks up the most recent run for this
-- hash. If none exists, the most recent is 'completed', or p_force_new
-- is true (the user explicitly chose "Start over" on an offered
-- resume), starts a brand-new run (fresh restore_runs row, all six
-- sections 'pending') -- the old run row, if any, is left exactly as it
-- was, never deleted or overwritten, so its history stays queryable.
-- Otherwise, if the most recent matching run is 'running', 'completed_
-- with_failures', or 'cancelled', returns THAT run instead (resume).
-- Returns jsonb: { run_id, resumed: boolean, sections: [{section,
-- status, warnings}] } so the caller knows exactly which sections to
-- skip.
-- ============================================================

create or replace function public.start_or_resume_restore_run(p_snapshot_hash text, p_force_new boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_run_id uuid;
  v_run_status text;
  v_resumed boolean := false;
  v_sections jsonb;
begin
  if not public.is_app_admin(v_actor_id) then
    raise exception 'Only an admin may restore a backup.' using errcode = 'EC001';
  end if;
  if p_snapshot_hash is null or char_length(btrim(p_snapshot_hash)) = 0 then
    raise exception 'snapshot_hash is required.' using errcode = 'EC001';
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  if not p_force_new then
    select rr.id, rr.status into v_run_id, v_run_status
      from public.restore_runs as rr
      where rr.snapshot_hash = p_snapshot_hash
      order by rr.started_at desc
      limit 1;
  end if;

  if v_run_id is not null and v_run_status in ('running', 'completed_with_failures', 'cancelled') then
    v_resumed := true;
    update public.restore_runs set status = 'running', finished_at = null where id = v_run_id;
  else
    insert into public.restore_runs (snapshot_hash, started_by_email)
      values (p_snapshot_hash, coalesce(v_actor_email, 'unknown'))
      returning id into v_run_id;
    insert into public.restore_run_sections (restore_run_id, section)
      select v_run_id, s.section
      from unnest(array['inventoryItems','deviceRecipes','projectSites','purchaseRequests','projectDocuments','movementsBuildsAllocations']) as s(section);
  end if;

  select jsonb_agg(jsonb_build_object('section', rrs.section, 'status', rrs.status, 'warnings', rrs.warnings))
    into v_sections
    from public.restore_run_sections as rrs
    where rrs.restore_run_id = v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'resumed', v_resumed, 'sections', coalesce(v_sections, '[]'::jsonb));
end;
$$;

revoke all on function public.start_or_resume_restore_run(text, boolean) from public;
revoke execute on function public.start_or_resume_restore_run(text, boolean) from anon;
grant execute on function public.start_or_resume_restore_run(text, boolean) to authenticated;

-- ============================================================
-- update_restore_run_section: called once per section as it completes
-- (success, failure, or skipped-empty). A simple upsert on the existing
-- (restore_run_id, section) row created at run-start.
-- ============================================================

create or replace function public.update_restore_run_section(
  p_restore_run_id uuid,
  p_section text,
  p_status text,
  p_attempted_count int,
  p_succeeded_count int,
  p_error text default null,
  p_warnings text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may update a restore run.' using errcode = 'EC001';
  end if;
  if p_status not in ('pending', 'succeeded', 'failed', 'skipped_empty') then
    raise exception 'Invalid section status.' using errcode = 'EC001';
  end if;

  update public.restore_run_sections as rrs
    set status = p_status,
        attempted_count = p_attempted_count,
        succeeded_count = p_succeeded_count,
        error = p_error,
        warnings = p_warnings,
        updated_at = now()
    where rrs.restore_run_id = p_restore_run_id and rrs.section = p_section;

  if not found then
    raise exception 'This restore run/section could not be found.' using errcode = 'EC003';
  end if;
end;
$$;

revoke all on function public.update_restore_run_section(uuid, text, text, int, int, text, text[]) from public;
revoke execute on function public.update_restore_run_section(uuid, text, text, int, int, text, text[]) from anon;
grant execute on function public.update_restore_run_section(uuid, text, text, int, int, text, text[]) to authenticated;

-- ============================================================
-- finalize_restore_run: computes the run's overall status from its
-- sections' current state -- 'completed' only when every section is
-- 'succeeded' or 'skipped_empty', 'completed_with_failures' otherwise --
-- matching RestoreOutcome.ok's existing "true only when every attempted
-- section succeeded" rule, just persisted.
-- ============================================================

create or replace function public.finalize_restore_run(p_restore_run_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_final_status text;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may finalize a restore run.' using errcode = 'EC001';
  end if;

  select case when bool_and(rrs.status in ('succeeded', 'skipped_empty')) then 'completed' else 'completed_with_failures' end
    into v_final_status
    from public.restore_run_sections as rrs
    where rrs.restore_run_id = p_restore_run_id;

  if v_final_status is null then
    raise exception 'This restore run could not be found.' using errcode = 'EC003';
  end if;

  update public.restore_runs set status = v_final_status, finished_at = now() where id = p_restore_run_id;

  return v_final_status;
end;
$$;

revoke all on function public.finalize_restore_run(uuid) from public;
revoke execute on function public.finalize_restore_run(uuid) from anon;
grant execute on function public.finalize_restore_run(uuid) to authenticated;

-- ============================================================
-- cancel_restore_run: a running restore can be cancelled between
-- sections (never mid-section -- see spec §5). Cancel is not a dead
-- end: a cancelled run resumes exactly like completed_with_failures via
-- start_or_resume_restore_run's own status check above, no separate
-- mechanism needed.
-- ============================================================

create or replace function public.cancel_restore_run(p_restore_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may cancel a restore run.' using errcode = 'EC001';
  end if;

  update public.restore_runs as rr
    set status = 'cancelled', finished_at = now()
    where rr.id = p_restore_run_id and rr.status = 'running';

  if not found then
    raise exception 'This restore run could not be found or is not currently running.' using errcode = 'EC003';
  end if;
end;
$$;

revoke all on function public.cancel_restore_run(uuid) from public;
revoke execute on function public.cancel_restore_run(uuid) from anon;
grant execute on function public.cancel_restore_run(uuid) to authenticated;

commit;

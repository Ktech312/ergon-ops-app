-- Same-day follow-up to migration 164 (Phase 3 Stage 5). LIVE PRODUCTION
-- INCIDENT: E ran migration 164 successfully, then its canonical test
-- failed immediately at the very first fixture insert --
--
--   ERROR: 42501: permission denied for function resolve_caller_workspace_id
--   CONTEXT: PL/pgSQL function public.assign_project_ref() line 11 at
--   assignment
--
-- Root cause, confirmed directly from migration 117's own header comment
-- (117:118-145): resolve_caller_workspace_id() deliberately has EXECUTE
-- revoked from everyone (`revoke all ... from public`, no grant to
-- `authenticated`) and is designed to be called ONLY from inside another
-- SECURITY DEFINER function -- the inner call then executes under that
-- outer function's DEFINER privileges (the migration-running role,
-- effectively an owner/superuser), not the original authenticated
-- caller's, which is exactly what lets guard_workspace_id_mutation(),
-- replace_project_bom_lines(), respond_to_proposal_question(),
-- submit_proposal_question(), and save_equipment_recipe() all call it
-- successfully today -- every one of them is `security definer`.
--
-- Migration 164's rewritten assign_sales_quote_ref()/assign_project_ref()
-- are the ONLY consumers of resolve_caller_workspace_id() in this entire
-- codebase that are plain SECURITY INVOKER functions (carried forward
-- from their pre-164 bodies, which never needed to call it at all) --
-- calling it directly from an invoker-rights trigger function means the
-- EXECUTE check runs against the REAL calling role (`authenticated`,
-- during any ordinary INSERT from the app), which correctly has no
-- grant, hence the permission-denied error. Since sales_quotes/projects
-- inserts almost never supply an explicit quote_ref/project_number (the
-- whole point of these triggers is auto-assignment), this broke EVERY
-- normal sales quote and project creation in production the moment
-- migration 164 went live.
--
-- Per this repo's standing rule, migration 164 itself is NOT edited or
-- rerun -- both functions are simply redefined again here (CREATE OR
-- REPLACE preserves the same oid, so their triggers, already created by
-- migration 164, do not need to be recreated). The only change from
-- migration 164's bodies: `security definer` added to each, matching
-- every other consumer of resolve_caller_workspace_id() in this
-- codebase. No other line changes -- same workspace-resolution and
-- counter-key logic migration 164 already shipped.
--
-- Confirm 165 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- URGENT, live incident.

begin;

create or replace function public.assign_sales_quote_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_year integer := extract(year from pg_catalog.now())::integer;
  v_workspace_id uuid;
  seq integer;
begin
  if new.quote_ref is not null then
    return new;
  end if;

  v_workspace_id := public.resolve_caller_workspace_id();

  insert into public.sales_quote_ref_counters as sqrc (workspace_id, year, next_seq)
  values (v_workspace_id, ref_year, 2)
  on conflict (workspace_id, year) do update set next_seq = sqrc.next_seq + 1
  returning next_seq - 1 into seq;

  new.quote_ref := 'SQ-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  return new;
end;
$$;

revoke all on function public.assign_sales_quote_ref() from public;
revoke execute on function public.assign_sales_quote_ref() from anon;
revoke execute on function public.assign_sales_quote_ref() from authenticated;

create or replace function public.assign_project_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_year integer := extract(year from pg_catalog.now())::integer;
  v_workspace_id uuid;
  seq integer;
begin
  if new.project_number is not null then
    return new;
  end if;

  v_workspace_id := public.resolve_caller_workspace_id();

  insert into public.project_ref_counters as prc (workspace_id, year, next_seq)
  values (v_workspace_id, ref_year, 2)
  on conflict (workspace_id, year) do update set next_seq = prc.next_seq + 1
  returning next_seq - 1 into seq;

  new.project_number := 'PRJ-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  return new;
end;
$$;

revoke all on function public.assign_project_ref() from public;
revoke execute on function public.assign_project_ref() from anon;
revoke execute on function public.assign_project_ref() from authenticated;

commit;

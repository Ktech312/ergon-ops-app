-- Migration 128: harden the trigger chain that fires on every INSERT into
-- public.projects, so it no longer inherits an empty search_path from a
-- caller like create_project_from_quote() (migration 127).
--
-- Migration 127's own live production verification reached the real
-- project INSERT and failed: assign_project_ref() (migration 067, a BEFORE
-- INSERT trigger on projects) has no SET search_path of its own, so when
-- fired from inside create_project_from_quote()'s `set search_path=''`
-- context, it inherited that empty search_path -- its unqualified
-- reference to project_ref_counters could not resolve. This is the exact
-- same bug class migration 123 fixed for get_users_by_role() (called from
-- inside respond_to_submittal()'s own search_path='' context), and the
-- exact same class this session's create_project_from_quote() work
-- specifically avoided by never calling the unhardened has_role() -- this
-- migration closes the one place that same class of bug was still live,
-- reachable the moment migration 127 actually inserts a real projects row.
--
-- A full trace of every trigger that fires on INSERT for every table
-- create_project_from_quote() writes to -- projects, project_scope_of_work,
-- project_bom_lines, project_locations, project_location_items,
-- project_conversion_receipts -- found exactly two INSERT-firing triggers
-- across all of them, both on projects, both fixed here:
--   1. assign_project_ref() (migration 067) -- BEFORE INSERT, plain
--      (security invoker), unqualified project_ref_counters reference.
--   2. create_project_channel() (migration 101) -- AFTER INSERT, already
--      SECURITY DEFINER, unqualified channels reference. Being SECURITY
--      DEFINER does not by itself protect against this -- without its own
--      SET search_path, a called function still inherits the caller's
--      ambient search_path at the time it's invoked, regardless of
--      definer/invoker status.
-- No other INSERT trigger exists on any of the six tables (project_
-- scope_of_work/project_bom_lines/project_locations each only have a
-- BEFORE UPDATE "set updated_at" trigger, never fired by an INSERT;
-- project_location_items and project_conversion_receipts have no triggers
-- at all) -- confirmed by grepping every `... insert on ...` trigger
-- definition in every migration file, not just these two known ones. No
-- other concrete blocker exists, so no other function is touched here.
--
-- Neither function's signature, return shape, or actual behavior changes:
-- same project-number format ('PRJ-YYYY-NNNN', same per-year counter
-- table, same race-safe on-conflict increment), same channel
-- name/type/project-linkage/conflict-handling. Only three things change
-- per function: SET search_path = '' (so it can never again inherit an
-- unsafe ambient search_path from any caller, not just this one), every
-- table reference fully schema-qualified, and (assign_project_ref()
-- specifically) an explicit target-table alias in its ON CONFLICT ...DO
-- UPDATE clause -- a schema-qualified correlation name
-- (public.project_ref_counters.next_seq) is not valid syntax there, so an
-- alias is the correct fix, not just a stylistic one.
--
-- Trigger identity is preserved by CREATE OR REPLACE FUNCTION alone (same
-- schema, name, and argument signature = same function identity/oid) --
-- neither existing trigger (projects_assign_ref, projects_create_channel)
-- needs to be dropped or recreated.
--
-- migration 127 itself is NOT modified or rerun by this file -- it is
-- already applied. This migration only touches the two trigger functions
-- named above (plus their grants); nothing else.
--
-- Do not run this migration until E has reviewed it and the accompanying
-- test additions in migration_127_conversion_tests.sql.

begin;

-- ============================================================
-- 1. assign_project_ref() (migration 067) -- BEFORE INSERT on projects.
-- ============================================================

create or replace function public.assign_project_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ref_year integer := extract(year from pg_catalog.now())::integer;
  seq integer;
begin
  if new.project_number is not null then
    return new;
  end if;

  -- `prc` is required here, not cosmetic: a schema-qualified correlation
  -- name (public.project_ref_counters.next_seq) is not valid syntax inside
  -- an ON CONFLICT ... DO UPDATE SET expression -- Postgres resolves that
  -- clause's table reference by the INSERT's own target/alias, and only
  -- accepts the bare table name or an explicit alias there.
  insert into public.project_ref_counters as prc (year, next_seq)
  values (ref_year, 2)
  on conflict (year) do update set next_seq = prc.next_seq + 1
  returning next_seq - 1 into seq;

  new.project_number := 'PRJ-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  return new;
end;
$$;

revoke all on function public.assign_project_ref() from public;
revoke execute on function public.assign_project_ref() from anon;
revoke execute on function public.assign_project_ref() from authenticated;

-- ============================================================
-- 2. create_project_channel() (migration 101) -- AFTER INSERT on projects.
-- ============================================================

create or replace function public.create_project_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channels (type, project_id, name)
  values ('project', new.id, new.project_name)
  on conflict (type, project_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_project_channel() from public;
revoke execute on function public.create_project_channel() from anon;
revoke execute on function public.create_project_channel() from authenticated;

-- Neither revoke above weakens trigger execution -- trigger invocation is
-- performed by the executor as part of processing the table's defined
-- trigger, not as an ACL-checked function call by the DML-issuing role, so
-- no EXECUTE grant on the trigger function itself is ever needed for it to
-- fire. This is the same, already-validated pattern migration 117 uses for
-- guard_workspace_id_mutation() -- see that migration's own header comment
-- and migration_117 test coverage for the empirical proof of this exact
-- claim in this project.

commit;

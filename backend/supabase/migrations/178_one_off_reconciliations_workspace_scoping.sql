-- Phase 3 final scoping pass (overnight, 2026-09-19) -- E's standing
-- default applies. `one_off_reconciliations` (migration 093) is a flat,
-- anchor-less log of manual inventory-merge resolutions -- re-confirmed
-- directly from source: no FK columns at all, RLS today is
-- `using(true)` for SELECT and `with check(true)` for INSERT (no
-- UPDATE/DELETE policy exists, matching the original design). Once a
-- second workspace exists, any user in any company could read every
-- other company's one-off inventory reconciliation history.
--
-- Fix: same root-table pattern as `team_members`/`product_catalog` --
-- `guard_workspace_id_mutation()` derives `workspace_id` from the
-- caller's own resolved workspace on INSERT. No uniqueness constraint
-- exists on this table today (only the PK) -- none is added here,
-- since none existed to begin with.
--
-- Note found while scoping this (not fixed here, out of this
-- migration's scope): `logOneOffReconciliation()` write failures are
-- currently caught but only logged to a UI status message, not treated
-- as blocking (`src/main.tsx:6468-6474`) -- a future RLS rejection here
-- would reproduce the exact "silently didn't save, reappears after
-- reload" symptom this table's own `logOneOffReconciliation` comment
-- already describes fixing once before. This migration does not change
-- that error-handling behavior; flagging it since a workspace-scoping
-- RLS change is exactly the kind of thing that could newly trigger it
-- if `resolve_caller_workspace_id()` ever raised for some caller.
--
-- Confirm 178 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

alter table public.one_off_reconciliations
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_one_off_reconciliations_workspace_id on public.one_off_reconciliations(workspace_id);

update public.one_off_reconciliations
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.one_off_reconciliations where workspace_id is null) then
    raise exception 'backfill incomplete: one_off_reconciliations.workspace_id still has nulls';
  end if;
end $$;

alter table public.one_off_reconciliations alter column workspace_id set not null;

drop trigger if exists one_off_reconciliations_guard_workspace_id on public.one_off_reconciliations;
create trigger one_off_reconciliations_guard_workspace_id
  before insert or update on public.one_off_reconciliations
  for each row execute function public.guard_workspace_id_mutation();

drop policy if exists "authenticated read one_off_reconciliations" on public.one_off_reconciliations;
drop policy if exists "authenticated write one_off_reconciliations" on public.one_off_reconciliations;

create policy "workspace members read one_off_reconciliations"
  on public.one_off_reconciliations for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members write one_off_reconciliations"
  on public.one_off_reconciliations for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

commit;

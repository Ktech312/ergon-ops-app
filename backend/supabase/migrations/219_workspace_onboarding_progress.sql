-- Migration 219: workspace_onboarding_progress -- Phase 4 (guided
-- onboarding), the checklist/progress-persistence piece. Follows
-- PRODUCT_ONBOARDING_CONFIGURATION_PLAN.md §12's own proposed shape and
-- name exactly: "A literal onboarding checklist screen (Add your logo ->
-- Invite your team -> Set up your first sales template -> Configure
-- notification rules -> You're ready) -- a thin UI layer over the above,
-- no new backend beyond a workspace_onboarding_progress table tracking
-- which steps are done." PRODUCT_ONBOARDING_CONFIG.md §12 independently
-- confirmed, via a direct repo-wide search, that nothing like this exists
-- today (only a placeholder Learning Library string and an unrelated
-- static welcome slideshow) -- this migration is the first real backend
-- for it.
--
-- Five steps, one per already-real, already-workspace-scoped panel this
-- session either found already working or just finished building:
-- company_branding (Company Branding), team_invited (Team Roster
-- invite), modules_reviewed (the new Module Settings panel, migration
-- 218), sales_template (Proposal Template sections), notifications
-- (Notification Rules). Deliberately excludes the two items neither
-- planning doc could resolve without a further design pass: a starter
-- catalog/industry-template import step (§7's own design is explicitly
-- superseded, no replacement decided yet) and a "sample workflow"
-- step (no concrete, decision-free definition of what one auto-verified
-- run would even check). Adding either later is additive -- just a new
-- allowed step_key value -- not a breaking change to this table.
--
-- Same opt-out-friendly, additive shape as migration 218: no row for a
-- step means "not done yet" (the default a brand-new workspace, or any
-- workspace that existed before this migration, correctly starts at).
-- Writes go only through set_onboarding_step_status(), mirroring
-- migration 218's set_workspace_module_enabled() exactly.

begin;

create table if not exists public.workspace_onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_key text not null check (step_key in (
    'company_branding', 'team_invited', 'modules_reviewed', 'sales_template', 'notifications_reviewed'
  )),
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (workspace_id, step_key)
);

create index if not exists idx_workspace_onboarding_progress_workspace_id
  on public.workspace_onboarding_progress(workspace_id);

alter table public.workspace_onboarding_progress enable row level security;

-- Read/write both restricted to that workspace's own admins (or a global
-- app_admin) -- this is an admin setup flow, not something every ordinary
-- employee needs visibility into, same posture as the Module Settings
-- panel it sits next to in Admin.
create policy "workspace admins read own workspace onboarding progress"
  on public.workspace_onboarding_progress for select to authenticated
  using (
    public.is_app_admin(auth.uid())
    or (public.is_active_workspace_member(workspace_id) and public.is_workspace_admin(workspace_id))
  );

revoke all on public.workspace_onboarding_progress from public;
revoke all on public.workspace_onboarding_progress from anon;
grant select on public.workspace_onboarding_progress to authenticated;

create or replace function public.set_onboarding_step_status(p_step_key text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := public.resolve_caller_workspace_id();

  if not (public.is_app_admin(auth.uid()) or public.is_workspace_admin(v_workspace_id)) then
    raise exception 'Only a workspace admin may update onboarding progress';
  end if;

  if p_status not in ('pending', 'done', 'skipped') then
    raise exception 'Invalid onboarding step status: %', p_status;
  end if;

  insert into public.workspace_onboarding_progress (workspace_id, step_key, status, updated_at, updated_by)
  values (v_workspace_id, p_step_key, p_status, clock_timestamp(), auth.uid())
  on conflict (workspace_id, step_key)
  do update set status = excluded.status, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.set_onboarding_step_status(text, text) from public;
revoke execute on function public.set_onboarding_step_status(text, text) from anon;
grant execute on function public.set_onboarding_step_status(text, text) to authenticated;

commit;

-- Confirm 220 is still the next free migration number before running any
-- migration this session generates after this one. Not applied. Kept
-- local for E's review.

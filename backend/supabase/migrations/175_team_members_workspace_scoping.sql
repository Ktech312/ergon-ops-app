-- Phase 3 final scoping pass (overnight, 2026-09-19) -- E's standing
-- default applies: "each company should have its own separate copies."
-- `team_members` (migration 019) is a real, separate staff-directory
-- table -- explicitly NOT tied to `auth.users` (019's own header:
-- "someone can be added and assigned tasks before they've ever logged
-- into the app"), so it has no FK to piggyback workspace scoping on.
-- Re-confirmed directly from source before writing this: RLS today is
-- `using(true)` for SELECT (any authenticated user can read the entire
-- roster of every company) plus an admin/manager write policy (019) and
-- a self-service carve-out letting any authenticated user
-- INSERT/UPDATE (not DELETE) the one row matching their own JWT email
-- (035). Once a second workspace exists, this means any user in any
-- company can read every OTHER company's full staff directory
-- (names, emails, role titles, Slack IDs, avatars).
--
-- Fix: same root-table pattern as `clients`/`vendors`/`projects` --
-- `guard_workspace_id_mutation()` (migration 117) derives `workspace_id`
-- from the CALLER's own resolved workspace on INSERT (this fits cleanly
-- here: whoever adds a roster entry -- an admin/manager for the normal
-- path, or the person themselves for the self-service path -- is always
-- a real, currently-authenticated workspace member at the moment of
-- insert). The existing unique index on `lower(email)` becomes
-- workspace-scoped, matching migration 164's pattern for other
-- columns -- two different companies can now have a roster member with
-- the same email (unlikely in practice, but no longer forced to
-- collide if it happens).
--
-- Confirm 175 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL (same three-step shape as every other Stage 1-5
-- workspace_id rollout).
-- ============================================================

alter table public.team_members
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_team_members_workspace_id on public.team_members(workspace_id);

update public.team_members
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.team_members where workspace_id is null) then
    raise exception 'backfill incomplete: team_members.workspace_id still has nulls';
  end if;
end $$;

alter table public.team_members alter column workspace_id set not null;

-- ============================================================
-- Section 2 -- Ownership trigger: guard_workspace_id_mutation()
-- (migration 117), verbatim, same as every other root table with no
-- anchor to derive from instead.
-- ============================================================

drop trigger if exists team_members_guard_workspace_id on public.team_members;
create trigger team_members_guard_workspace_id
  before insert or update on public.team_members
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 3 -- Uniqueness: the existing partial unique index on
-- lower(email) becomes workspace-scoped, same pattern as migration 164.
-- ============================================================

drop index if exists idx_team_members_email;
create unique index idx_team_members_workspace_id_email
  on public.team_members(workspace_id, lower(email))
  where email is not null and email <> '';

-- ============================================================
-- Section 4 -- RLS: workspace-scoped, both the admin/manager write
-- policy and the self-service carve-out ANDed with workspace
-- membership (never replaced -- both role checks stay meaningful,
-- just not sufficient alone once a second workspace exists).
-- ============================================================

drop policy if exists "authenticated read team_members" on public.team_members;
drop policy if exists "admins and managers write team_members" on public.team_members;
drop policy if exists "users insert their own team_members row" on public.team_members;
drop policy if exists "users update their own team_members row" on public.team_members;

create policy "workspace members read team_members"
  on public.team_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: admins and managers write team_members"
  on public.team_members for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_app_manager(auth.uid()))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_app_manager(auth.uid()))
  );

create policy "workspace members: users insert their own team_members row"
  on public.team_members for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "workspace members: users update their own team_members row"
  on public.team_members for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

commit;

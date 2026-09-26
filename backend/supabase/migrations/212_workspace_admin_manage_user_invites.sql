-- Migration 212: a fourth instance of the same bug class found today
-- (migrations 210/211's own headers) -- found proactively this time, by
-- auditing for it rather than waiting for E to hit it live.
--
-- `user_invites`' own read AND write RLS policies (migration 181) require
-- `is_app_admin(auth.uid())` ONLY -- no `is_workspace_admin(workspace_id)`
-- OR-branch at all, unlike every other table migration 185 already
-- widened for exactly this reason. A real K-Tech Systems founding admin
-- (workspace_members.is_workspace_admin = true, correctly never in the
-- global, legacy app_admins table) can neither see nor create ANY invite
-- for their own company today -- acceptance requirement #9 ("the new
-- company can invite a teammate") is currently false for every
-- self-serve company, not just K-Tech.
--
-- Fix: exactly migration 185's own established pattern, applied to the
-- two policies it missed. `is_workspace_admin(workspace_id)` only ever
-- reflects the caller's own single workspace's own membership row, so
-- this grants no cross-workspace access -- a K-Tech admin still cannot
-- see or write an Ergon Test Workspace invite, or vice versa.

begin;

drop policy if exists "workspace members: admins read user_invites" on public.user_invites;
create policy "workspace members: admins read user_invites"
  on public.user_invites for select to authenticated
  using (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "workspace members: admins write user_invites" on public.user_invites;
create policy "workspace members: admins write user_invites"
  on public.user_invites for all to authenticated
  using (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_active_workspace_member(workspace_id)
  )
  with check (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_active_workspace_member(workspace_id)
  );

commit;

-- Confirm 212 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept local
-- for E's review.

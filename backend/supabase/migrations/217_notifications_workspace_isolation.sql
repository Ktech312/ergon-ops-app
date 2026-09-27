-- Migration 217: Phase 2D -- notifications. E's own instruction was
-- conditional: "Only broaden workspace-admin access if the product
-- actually exposes a workspace-level notification-management use
-- case." No such use case exists today (notifications are personal,
-- per-user, like Slack/Teams -- there is no "view my whole company's
-- notification inbox" admin screen anywhere in this app) -- so this
-- migration does NOT broaden anything for workspace admins.
--
-- What it DOES fix is a different, real problem the same investigation
-- surfaced: `notifications` has no workspace_id column at all (keyed
-- only by recipient_email), and its existing `is_app_admin(auth.uid())`
-- bypass is GLOBAL -- any Ergon employee holding the legacy app_admins
-- flag can currently read (and update the read/unread state of) every
-- OTHER company's employees' personal notifications, and the INSERT
-- policy (`with check (true)`) lets any authenticated user create a
-- notification targeting ANY recipient_email at all, regardless of
-- company. Both are real cross-tenant isolation gaps directly relevant
-- to the standing acceptance requirement "Ergon Test Workspace users
-- cannot see the new company's records" (this checklist explicitly
-- names notifications) -- not something to leave "lower priority"
-- once actually traced, even though the workspace-admin-widening
-- question itself correctly has no as of today.
--
-- Fix: a new helper, is_same_workspace_as_email(check_email) -- "does
-- this email belong to a real user who shares an ACTIVE workspace with
-- me?" Used to narrow (not broaden) the existing is_app_admin bypass on
-- read/update to same-workspace-only, and to gate insert the same way
-- (an ordinary user creating a notification for a teammate, e.g. task
-- assignment -- always same-company in real usage). Backend-generated
-- notifications (api/*.js routes using the service role, e.g. platform-
-- admin-on-signup notifications, migration 199) are unaffected --
-- service role bypasses RLS entirely, this only tightens the
-- `authenticated` role's own policies.

begin;

create or replace function public.is_same_workspace_as_email(check_email text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.workspace_members wm on wm.user_id = u.id
    where lower(u.email) = lower(check_email)
      and public.is_active_workspace_member(wm.workspace_id)
  );
$$;

revoke all on function public.is_same_workspace_as_email(text) from public;
revoke execute on function public.is_same_workspace_as_email(text) from anon;
grant execute on function public.is_same_workspace_as_email(text) to authenticated;

drop policy if exists "authenticated create notifications" on public.notifications;
create policy "authenticated create notifications" on public.notifications for insert to authenticated
  with check (is_same_workspace_as_email(recipient_email));

drop policy if exists "recipients read their own notifications" on public.notifications;
create policy "recipients read their own notifications" on public.notifications for select to authenticated
  using (
    lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (is_app_admin(auth.uid()) and is_same_workspace_as_email(recipient_email))
  );

drop policy if exists "recipients update their own notifications" on public.notifications;
create policy "recipients update their own notifications" on public.notifications for update to authenticated
  using (
    lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (is_app_admin(auth.uid()) and is_same_workspace_as_email(recipient_email))
  )
  with check (
    lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (is_app_admin(auth.uid()) and is_same_workspace_as_email(recipient_email))
  );

commit;

-- Confirm 217 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept
-- local for E's review.

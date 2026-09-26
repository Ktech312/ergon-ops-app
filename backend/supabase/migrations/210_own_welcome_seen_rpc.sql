-- Migration 210: fix a second instance of the same class of bug migration
-- 209 fixed for the sign-in gate -- a real K-Tech Systems founding admin
-- (workspace_members.is_workspace_admin = true, correctly never touched
-- app_admins) got the first-login welcome walkthrough on every single
-- sign-in, never just once, because markWelcomeSeen's PATCH to
-- app_user_status silently affected zero rows.
--
-- Root cause: app_user_status's only UPDATE policy (migration 014,
-- "admins and managers review status") requires
-- is_app_admin(auth.uid()) or is_app_manager(auth.uid()) -- both
-- predate workspace_members (migration 115) entirely. A caller who is
-- neither of those (any brand-new company's founding admin, exactly
-- like the isApproved gate migration 209 fixed) cannot update ANY row
-- in this table, including their own has_seen_welcome flag. PostgREST
-- returns 200 with zero rows affected for an update whose USING clause
-- excludes every row -- not an error -- so markWelcomeSeen's own
-- `.catch(() => undefined)` never even fires; the failure is invisible
-- until you actually watch it happen twice.
--
-- Fix, deliberately NOT a fourth RLS policy opening self-updates on this
-- table: broadening app_user_status's UPDATE policy to
-- "auth.uid() = user_id" would let ANY authenticated user PATCH their
-- own approval_status directly to 'approved' via the public REST API --
-- a real self-approval hole, not a narrow fix. Instead, a single-purpose
-- security-definer RPC that touches exactly one column, for exactly the
-- caller's own row, resolved from auth.uid() (never a client-supplied
-- id) -- the same minimal-privilege shape this schema already uses
-- elsewhere for exactly this reason.

begin;

create or replace function public.mark_own_welcome_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.app_user_status set has_seen_welcome = true where user_id = auth.uid();
$$;

revoke all on function public.mark_own_welcome_seen() from public;
revoke execute on function public.mark_own_welcome_seen() from anon;
grant execute on function public.mark_own_welcome_seen() to authenticated;

commit;

-- Confirm 210 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept local
-- for E's review.

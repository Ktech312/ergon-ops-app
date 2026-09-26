-- Migration 209: repair the company-signup claim path after the real
-- K-Tech Systems onboarding test (2026-09-26) failed to complete
-- end-to-end. E's own instruction, after pausing the live test rather
-- than continuing to retry it manually:
--
--   "The finished onboarding experience must be:
--   1. Platform admin approves the company once.
--   2. The approved founder opens one claim link.
--   3. The page already knows the approved email. Do not show a blank
--      editable email field.
--   4. If the account is new, it creates the password.
--   5. If the account already exists, it offers Sign in to claim.
--   6. If email confirmation is required, show the exact destination
--      address, a resend action, and a clear Continue to sign in action.
--   7. The confirmation redirect must preserve the company claim and
--      return to it automatically, including when confirmation happens
--      in another tab or browser.
--   8. After confirmation/sign-in, the claim must complete automatically
--      and open K-Tech Systems. It must never fall into the generic
--      employee waiting-for-approval flow.
--   9. Every failure state must explain what happened and provide the
--      next action."
--
-- This migration covers the two backend changes items 3-9 depend on.
-- Items 4/6/9's remaining UI work and item 10 (the E2E test) are
-- companion, non-SQL changes in the same commit.
--
-- ============================================================
-- Item 3 -- get_company_signup_by_token must return the approved email
-- and whether an account already exists for it, so the claim page can
-- pre-fill and LOCK the email field instead of showing a blank editable
-- one. Requires a DROP first -- CREATE OR REPLACE cannot add output
-- columns (same constraint migration 196 hit adding `status`).
--
-- Disclosure check: this does not turn the RPC into a general email/
-- account-existence oracle. It only ever reveals whether ONE SPECIFIC,
-- already platform-admin-approved requester_email has an account --
-- and only to whoever holds that exact request's signup_token (an
-- unguessable uuid, never enumerable). Nothing here lets a caller check
-- an arbitrary email of their choosing.
-- ============================================================

drop function if exists public.get_company_signup_by_token(uuid);

create function public.get_company_signup_by_token(p_token uuid)
returns table (company_name text, status text, requester_email text, account_exists boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select
    r.company_name,
    case
      when r.status <> 'approved' then 'not_found'
      when r.signup_token_revoked_at is not null then 'revoked'
      when r.signup_token_expires_at is not null and r.signup_token_expires_at <= now() then 'expired'
      when r.signup_token_used_at is not null then 'used'
      else 'valid'
    end,
    r.requester_email,
    exists (
      select 1 from auth.users u
      where lower(btrim(u.email)) = lower(btrim(r.requester_email))
    )
  from public.company_signup_requests r
  where r.signup_token = p_token;
$$;

revoke all on function public.get_company_signup_by_token(uuid) from public;
grant execute on function public.get_company_signup_by_token(uuid) to anon;
grant execute on function public.get_company_signup_by_token(uuid) to authenticated;

-- ============================================================
-- Items 7/8 -- claim_own_pending_company_signup(): resolves and accepts
-- a company signup for the CALLER'S OWN authenticated email, with no
-- token parameter at all. Delegates straight to accept_company_signup
-- once it has located that request's own token -- zero duplicated
-- acceptance logic, every existing check (email-confirmed, email-match,
-- not-already-a-member-elsewhere, revoked/expired/used) still applies
-- exactly as migration 196 wrote it.
--
-- Why this exists: the current design only completes a claim when a
-- pendingCompanySignupToken happens to still be sitting in this same
-- browser's localStorage. That breaks the instant confirmation happens
-- in a different tab or a different browser/device than the one that
-- started the signup -- exactly the real failure the K-Tech test hit.
-- Keying this off "who did you just authenticate as" instead of "what
-- does this browser remember" means the claim completes regardless of
-- which browser confirms the email, closing item 7 and, by the same
-- mechanism, item 8 (a completed sign-in for an approved founder can no
-- longer fall through to the generic waiting-for-approval screen,
-- because this runs unconditionally on every successful sign-in, not
-- only when localStorage state survived).
--
-- Called unconditionally after every successful sign-in (email/password
-- and Google/OAuth alike) -- for the overwhelming majority of ordinary
-- sign-ins this finds nothing and returns 'none_pending' at the cost of
-- one indexed lookup, exactly like the existing pendingInviteToken/
-- pendingChannelGuestToken checks already do unconditionally today.
-- ============================================================

create or replace function public.claim_own_pending_company_signup()
returns table (outcome text, joined_workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_email text;
  v_token uuid;
begin
  if v_actor_id is null then
    return query select 'not_signed_in'::text, null::uuid;
    return;
  end if;

  select email into v_email from auth.users where id = v_actor_id;
  if v_email is null then
    return query select 'none_pending'::text, null::uuid;
    return;
  end if;

  select signup_token into v_token
  from public.company_signup_requests
  where status = 'approved'
    and lower(btrim(requester_email)) = lower(btrim(v_email))
    and signup_token_used_at is null
    and signup_token_revoked_at is null
    and (signup_token_expires_at is null or signup_token_expires_at > now())
  order by reviewed_at desc nulls last, created_at desc
  limit 1;

  if v_token is null then
    return query select 'none_pending'::text, null::uuid;
    return;
  end if;

  return query select * from public.accept_company_signup(v_token);
end;
$$;

revoke all on function public.claim_own_pending_company_signup() from public;
revoke execute on function public.claim_own_pending_company_signup() from anon;
grant execute on function public.claim_own_pending_company_signup() to authenticated;

-- Confirm 209 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept local
-- for E's review.

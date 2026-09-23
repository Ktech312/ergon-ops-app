-- Migration 196: corrective hardening of the company-signup claim path
-- (migration 195, applied and live -- this migration is written entirely
-- as `create or replace`/`alter table` against it, never editing 195's
-- own file, per this repo's standing discipline). E, 2026-09-22, after
-- reviewing 195 directly rather than accepting it as finished:
--
--   "Stop further onboarding expansion temporarily. Migration 195 is
--   live and must not be edited. Prepare a corrective migration 196 and
--   canonical verification script for the company-signup claim path."
--
-- This migration does not add any new onboarding capability -- it closes
-- eight specific, named defects in what 195 already shipped. No frontend
-- change is bundled with it except the one E explicitly named (item 7,
-- the API/client submitted:false contract bug) -- everything else stays
-- backend-only until reviewed.
--
-- ============================================================
-- Item 1/2 -- accept_company_signup must verify the CALLER, not just the
-- token
-- ============================================================
-- 195's accept_company_signup validated the token but never checked that
-- the person holding it is actually the person who requested the
-- company. A pending, isolated database issue -- a real one this migration
-- closes: any authenticated user who obtains a valid signup_token (a
-- leaked link, a shared inbox, a copy-paste mistake) could claim someone
-- ELSE's company and become its founding admin. Fixed: the caller's
-- email is read directly from auth.users via auth.uid() -- never a
-- client-supplied parameter, there isn't one -- and must match
-- company_signup_requests.requester_email case-insensitively and exactly
-- (btrim + lower on both sides, not a substring/prefix match). Item 2:
-- that same auth.users row's email_confirmed_at must be non-null --
-- an unconfirmed account should not be trusted to found a company's
-- entire workspace, the same trust bar every other "becomes an admin"
-- action in this schema implicitly assumes a real, confirmed account.
--
-- ============================================================
-- Item 3 -- reject acceptance if the account already belongs to another
-- workspace
-- ============================================================
-- This app has no multi-workspace switcher anywhere in the frontend --
-- exactly one workspace per signed-in user is the standing assumption
-- every other view in this app makes. Accepting a company signup with an
-- account that already has a real workspace_members row (anywhere) would
-- silently put that account into a state the rest of the app was never
-- built to handle. Rejected outright until a real active-workspace
-- selector exists (E's own words) -- not designed or scheduled here.
--
-- ============================================================
-- Item 4 -- token expiration + explicit admin revocation/regeneration
-- ============================================================
-- 195 shipped a token with no expiration and no way to invalidate one
-- after the fact short of rejecting the whole request (which 195 also
-- never allowed post-approval). Two new nullable columns
-- (signup_token_expires_at, signup_token_revoked_at) plus two new
-- platform-admin-only functions: revoke_company_signup_token() (kills a
-- live token outright) and regenerate_company_signup_token() (issues a
-- brand new token value, which by construction invalidates the old one --
-- nothing matches the old uuid anymore once the column is overwritten,
-- no separate history/blocklist needed). Default expiration: 7 days from
-- issuance (approval or regeneration) -- no existing documented decision
-- in this repo specifies a different default for this specific token
-- class (channel_guest_invites' suggested_expires_at is admin-chosen
-- per-invite with no fixed default; this is a distinct token, gets its
-- own default per E's own instruction).
--
-- ============================================================
-- Item 5 -- stop describing invalid links as expired unless expiration
-- is actually enforced
-- ============================================================
-- Now that expiration is real (item 4), get_company_signup_by_token can
-- honestly distinguish not_found / expired / revoked / used / valid --
-- mirrors get_channel_guest_invite_by_token's own established shape
-- exactly (188_external_channel_guest_access.sql:683-713): zero rows for
-- a token that never existed at all, one row with a computed `status`
-- column for a token that does. REQUIRES A DROP FUNCTION first --
-- CREATE OR REPLACE cannot change a function's output columns, only 195's
-- own single-column (company_name) shape existed before this.
--
-- ============================================================
-- Item 6 -- do not activate the provisioned workspace until its owner
-- accepts
-- ============================================================
-- 195 inserted the new workspaces row with status = 'active' at APPROVAL
-- time -- before anyone had actually claimed it. A workspace sitting
-- 'active' with zero members for however long it takes the prospect to
-- accept (if they ever do) is a real, if narrow, inconsistency: nothing
-- else in this schema currently queries "active workspaces with zero
-- members" so nothing was actively broken by it, but it does not match
-- what "active" is supposed to mean, and stacking a second signup on the
-- same slug base while the first sits unclaimed would be needlessly
-- confusing. Fixed with an explicit third status value, 'pending' (not
-- reusing 'suspended' -- a suspended workspace was once active and got
-- turned off; a pending one was never turned on, a different fact,
-- E's own explicit instruction not to overload 'suspended' for this).
-- approve_company_signup now inserts with status = 'pending';
-- accept_company_signup flips it to 'active' in the SAME transaction,
-- SAME statement sequence as the workspace_members insert -- both commit
-- together or neither does, by construction (plpgsql function body,
-- single implicit transaction, no explicit COMMIT inside it).
--
-- ============================================================
-- Item 8 -- preserve the Decided-table link retrieval already fixed live
-- tonight
-- ============================================================
-- companySignupLinkFor() (src/main.tsx) derives the copyable link from
-- signupToken/signupTokenUsedAt on the loaded row -- untouched by this
-- migration; get_company_signup_by_token's shape change (item 5) and the
-- two new columns (item 4) are additive, nothing this migration does
-- removes or renames signup_token/signup_token_used_at. Flagged
-- honestly, not silently left: that display does not yet grey out an
-- expired or revoked link (it will still show one, since it only checks
-- signupToken/signupTokenUsedAt, not the two new columns) -- a real,
-- known gap, not fixed here since it is frontend scope beyond what E
-- asked this migration to cover.
--
-- ============================================================
-- Item 7 -- the {submitted:false} contract bug -- companion code change,
-- not SQL
-- ============================================================
-- api/request-company-signup.js already correctly returns
-- {submitted:false, reason:"Not configured."} when Supabase env vars are
-- missing, with a 200 status (deliberately, so a misconfigured deploy
-- doesn't look like a validation error to the caller) -- but
-- requestCompanySignup() (src/persistence.ts) only ever checked
-- response.ok, which is true for a 200 regardless of the submitted
-- field, so the public form showed "Request received" even when nothing
-- was actually submitted. Fixed in the same commit as this migration,
-- not inside it (a .ts file, not SQL) -- requestCompanySignup() now also
-- requires body.submitted === true before treating the call as a
-- success.
--
-- ZZ Test Signup Co (the production test artifact from tonight's earlier
-- session, flagged in HANDOFF.md, awaiting E's own decision) is
-- deliberately NOT touched by this migration beyond the additive,
-- NULL-defaulting column adds below -- its existing signup_token,
-- signup_token_used_at (still null), and its already-provisioned
-- 'active' workspace are all left exactly as they were. Any future
-- acceptance attempt against that same token runs through this
-- migration's corrected logic like any other, which is the intended,
-- reviewed behavior E asked for -- not a retroactive rewrite of what
-- already happened.

begin;

-- ============================================================
-- Schema: two new nullable columns (item 4), a third workspace status
-- value (item 6).
-- ============================================================

alter table public.company_signup_requests
  add column if not exists signup_token_expires_at timestamptz,
  add column if not exists signup_token_revoked_at timestamptz;

alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check
  check (status in ('active', 'suspended', 'pending'));

-- ============================================================
-- RLS: is_app_admin() -> is_platform_admin() (the actual security fix
-- from the earlier conversation, not restated as its own migration item
-- above since it's the reason this whole corrective pass exists --
-- is_app_admin() is Ergon's OWN company admin flag, grantable to any of
-- Ergon's own employees via Team Roster's "Make admin" button; approving
-- an UNRELATED company onto the platform must never follow from that).
-- No raw signup-request/token data becomes visible to ordinary
-- authenticated users as a direct result of this change -- only a real
-- platform_admins row grants read/update access to this table at all.
-- ============================================================

drop policy if exists "platform admin read company_signup_requests" on public.company_signup_requests;
create policy "platform admin read company_signup_requests" on public.company_signup_requests for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "platform admin update company_signup_requests" on public.company_signup_requests;
create policy "platform admin update company_signup_requests" on public.company_signup_requests for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- approve_company_signup -- redefined: is_platform_admin() gate,
-- 'pending' (not 'active') workspace status, issues signup_token_expires_at
-- (now() + 7 days). Everything else (slug generation, company_branding
-- placeholder update, the section-channel provisioning trigger escape
-- hatch) is unchanged from 195, reproduced verbatim.
-- ============================================================

create or replace function public.approve_company_signup(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_signup_requests;
  v_workspace_id uuid;
  v_slug text;
  v_base_slug text;
  v_suffix int := 1;
  v_token uuid := gen_random_uuid();
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may approve a company signup request';
  end if;

  select * into v_request from public.company_signup_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Signup request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Signup request has already been % -- cannot approve again', v_request.status;
  end if;

  v_base_slug := lower(regexp_replace(regexp_replace(v_request.company_name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));
  if char_length(v_base_slug) = 0 then
    v_base_slug := 'company';
  end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.workspaces where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  -- Item 6: 'pending', not 'active' -- accept_company_signup activates it.
  insert into public.workspaces (name, slug, status)
  values (v_request.company_name, v_slug, 'pending')
  returning id into v_workspace_id;

  update public.company_branding set company_name = v_request.company_name where workspace_id = v_workspace_id;

  perform set_config('app.provisioning_workspace_id', v_workspace_id::text, true);

  insert into public.channels (type, section_key, name, workspace_id)
  values
    ('section', 'inventory', 'Inventory & Purchasing', v_workspace_id),
    ('section', 'projects', 'Projects', v_workspace_id),
    ('section', 'sales', 'Sales', v_workspace_id),
    ('section', 'marketing', 'Marketing', v_workspace_id)
  on conflict (type, section_key, workspace_id) do nothing;

  perform set_config('app.provisioning_workspace_id', '', true);

  update public.company_signup_requests
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      created_workspace_id = v_workspace_id,
      signup_token = v_token,
      signup_token_expires_at = now() + interval '7 days',
      signup_token_revoked_at = null
  where id = p_request_id;

  return jsonb_build_object('workspace_id', v_workspace_id, 'signup_token', v_token);
end;
$$;

revoke all on function public.approve_company_signup(uuid) from public;
revoke execute on function public.approve_company_signup(uuid) from anon;
grant execute on function public.approve_company_signup(uuid) to authenticated;

-- ============================================================
-- reject_company_signup -- redefined: is_platform_admin() gate only,
-- otherwise unchanged from 195.
-- ============================================================

create or replace function public.reject_company_signup(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_signup_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may reject a company signup request';
  end if;

  select * into v_request from public.company_signup_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Signup request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Signup request has already been % -- cannot reject again', v_request.status;
  end if;

  update public.company_signup_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_request_id;
end;
$$;

revoke all on function public.reject_company_signup(uuid, text) from public;
revoke execute on function public.reject_company_signup(uuid, text) from anon;
grant execute on function public.reject_company_signup(uuid, text) to authenticated;

-- ============================================================
-- revoke_company_signup_token -- new, item 4. Platform-admin-only. Kills
-- a live (approved, unused) token outright -- afterward
-- get_company_signup_by_token reports 'revoked' and accept_company_signup
-- rejects it with the same outcome, distinctly from 'expired'/'used'.
-- ============================================================

create or replace function public.revoke_company_signup_token(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_signup_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may revoke a company signup token';
  end if;

  select * into v_request from public.company_signup_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Signup request not found';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Only an approved request has a live token to revoke';
  end if;
  if v_request.signup_token_used_at is not null then
    raise exception 'This token has already been used -- nothing to revoke';
  end if;
  if v_request.signup_token_revoked_at is not null then
    raise exception 'This token was already revoked';
  end if;

  update public.company_signup_requests
  set signup_token_revoked_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.revoke_company_signup_token(uuid) from public;
revoke execute on function public.revoke_company_signup_token(uuid) from anon;
grant execute on function public.revoke_company_signup_token(uuid) to authenticated;

-- ============================================================
-- regenerate_company_signup_token -- new, item 4. Platform-admin-only.
-- Overwrites signup_token with a brand new value -- the OLD token value
-- stops matching any row the instant this commits, no separate
-- invalidation list needed. Clears any prior revocation and resets the
-- 7-day expiration clock. Only meaningful for a still-unclaimed approved
-- request -- an already-accepted one already has its founding admin,
-- regenerating its token would not do anything useful and is rejected.
-- ============================================================

create or replace function public.regenerate_company_signup_token(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_signup_requests;
  v_new_token uuid := gen_random_uuid();
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may regenerate a company signup token';
  end if;

  select * into v_request from public.company_signup_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Signup request not found';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Only an approved request has a token to regenerate';
  end if;
  if v_request.signup_token_used_at is not null then
    raise exception 'This request has already been accepted -- nothing to regenerate';
  end if;

  update public.company_signup_requests
  set signup_token = v_new_token,
      signup_token_expires_at = now() + interval '7 days',
      signup_token_revoked_at = null
  where id = p_request_id;

  return jsonb_build_object('signup_token', v_new_token);
end;
$$;

revoke all on function public.regenerate_company_signup_token(uuid) from public;
revoke execute on function public.regenerate_company_signup_token(uuid) from anon;
grant execute on function public.regenerate_company_signup_token(uuid) to authenticated;

-- ============================================================
-- get_company_signup_by_token -- item 5. Output columns change
-- (company_name) -> (company_name, status), so this needs an explicit
-- DROP first -- CREATE OR REPLACE cannot change a function's return
-- columns. Mirrors get_channel_guest_invite_by_token's own established
-- shape exactly (188_external_channel_guest_access.sql:683-713): zero
-- rows for a token that never existed, one row with a computed status
-- for a token that does. Never returns the token value itself or the
-- requester's name/email -- same minimal-disclosure posture as 195.
-- ============================================================

drop function if exists public.get_company_signup_by_token(uuid);

create function public.get_company_signup_by_token(p_token uuid)
returns table (company_name text, status text)
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
    end
  from public.company_signup_requests r
  where r.signup_token = p_token;
$$;

revoke all on function public.get_company_signup_by_token(uuid) from public;
grant execute on function public.get_company_signup_by_token(uuid) to anon;
grant execute on function public.get_company_signup_by_token(uuid) to authenticated;

-- ============================================================
-- accept_company_signup -- items 1, 2, 3, 6. Return shape (outcome text,
-- joined_workspace_id uuid) is UNCHANGED from 195 -- only the values
-- outcome can take are enriched, so this stays a plain CREATE OR REPLACE,
-- no DROP needed.
--
-- Check order, all inside one FOR UPDATE-locked view of the request row
-- so a concurrent second acceptance attempt for the same token always
-- sees the first attempt's committed result, never a stale one:
--   1. Caller must be signed in (auth.uid() not null) -- unchanged,
--      still raises rather than returning an outcome row, since this is
--      a programming-error case (the RPC called with no session at all),
--      not a normal declined-request the UI needs to render a message
--      for.
--   2. Token must resolve to a request row at all -> 'not_found'.
--   3. Row's status must be 'approved' -> 'not_found' (defensive; the
--      schema makes this unreachable in practice, since signup_token is
--      only ever set at approval time).
--   4. Not revoked -> 'revoked'.
--   5. Not expired -> 'expired'.
--   6. Not already used -> 'already_used'.
--   7. Caller's auth.users.email_confirmed_at is not null -> else
--      'email_not_confirmed'.
--   8. Caller's auth.users.email matches requester_email, case-
--      insensitive, exact (btrim + lower both sides) -> else
--      'email_mismatch'.
--   9. Caller has zero existing workspace_members rows anywhere -> else
--      'already_member_of_another_workspace'.
--   10. All checks passed: activate the workspace (status -> 'active')
--       and create the founding workspace_members row, atomically, then
--       mark the token used.
-- ============================================================

create or replace function public.accept_company_signup(p_token uuid)
returns table (outcome text, joined_workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.company_signup_requests;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to accept a company signup';
  end if;

  select * into v_request
  from public.company_signup_requests
  where signup_token = p_token
  for update;

  if v_request.id is null or v_request.status <> 'approved' then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if v_request.signup_token_revoked_at is not null then
    return query select 'revoked'::text, null::uuid;
    return;
  end if;

  if v_request.signup_token_expires_at is not null and v_request.signup_token_expires_at <= now() then
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  if v_request.signup_token_used_at is not null then
    return query select 'already_used'::text, null::uuid;
    return;
  end if;

  select email, email_confirmed_at into v_auth_email, v_email_confirmed_at
  from auth.users where id = v_actor_id;

  if v_email_confirmed_at is null then
    return query select 'email_not_confirmed'::text, null::uuid;
    return;
  end if;

  if lower(btrim(coalesce(v_auth_email, ''))) <> lower(btrim(v_request.requester_email)) then
    return query select 'email_mismatch'::text, null::uuid;
    return;
  end if;

  if exists (select 1 from public.workspace_members where user_id = v_actor_id) then
    return query select 'already_member_of_another_workspace'::text, null::uuid;
    return;
  end if;

  -- Item 6: activate the workspace and create its founding admin
  -- membership atomically -- both statements below commit together or
  -- neither does, by construction (this is one plpgsql function body,
  -- inside the single implicit transaction PostgREST already wraps every
  -- RPC call in).
  update public.workspaces set status = 'active' where id = v_request.created_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (v_request.created_workspace_id, v_actor_id, true)
  on conflict (workspace_id, user_id) do update set is_workspace_admin = true;

  update public.company_signup_requests
  set signup_token_used_at = now()
  where id = v_request.id;

  return query select 'accepted'::text, v_request.created_workspace_id;
end;
$$;

revoke all on function public.accept_company_signup(uuid) from public;
revoke execute on function public.accept_company_signup(uuid) from anon;
grant execute on function public.accept_company_signup(uuid) to authenticated;

commit;

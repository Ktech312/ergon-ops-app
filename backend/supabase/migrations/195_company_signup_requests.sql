-- Migration 195: self-serve company signup, gated by E's manual per-
-- company approval -- the "lightweight" path of Stage 7 onboarding
-- (PRODUCT_ONBOARDING_CONFIG.md's 2026-09-22 update), explicitly chosen
-- over a full guided wizard until a real second company has gone through
-- it at least once. E's own words: "let's start with lightweight and
-- once everything actually works and is tested 100, we build the guide."
--
-- ============================================================
-- The flow this migration builds
-- ============================================================
-- 1. A prospect submits company name + their own name/email on a public
--    page. This is a genuinely NEW kind of surface for this schema --
--    every other write path so far requires a signed-in session. Handled
--    the same way every other "needs abuse protection, not just RLS"
--    concern in this app is handled: the actual write happens through a
--    NEW Vercel API route (api/request-company-signup.js, this pass's
--    own companion change, not part of this migration) using the
--    service-role connection, with IP+email rate limiting applied there
--    -- Postgres/RLS has no concept of "requests per minute," so that
--    layer has to live in the API route, same reasoning already
--    documented for every rate-limited route in api/_lib/rateLimit.js.
--    submit_company_signup_request() itself is granted to NOBODY except
--    the implicit service-role bypass -- there is no anon or authenticated
--    grant on it at all, so the only way to reach it is through that one
--    rate-limited API route, never a direct browser-side RPC call.
-- 2. E (platform admin, is_app_admin() -- the same pre-workspace global
--    flag used for every other genuinely platform-wide action in this
--    schema, not a per-workspace admin, since no workspace exists yet at
--    request time) reviews pending requests and approves or rejects.
--    Approval provisions a real, immediately-isolated workspace -- see
--    §3 below for exactly what "provisioned" means -- and generates a
--    bearer token (same shape as channel_guest_invites' token, migration
--    188): no email-sending infrastructure exists reliably in this app
--    today (HANDOFF.md's own long-standing note), so the token is shown
--    to E to copy/send however they choose, mirroring the guest-invite
--    flow exactly rather than inventing a new distribution mechanism.
-- 3. The prospect visits a link carrying that token, which shows them
--    which company they're joining (get_company_signup_by_token, anon-
--    safe, read-only -- mirrors get_channel_guest_invite_by_token), does
--    a normal client-side Supabase Auth signup (same pattern as every
--    other accept-invite flow in this app -- InviteLandingPage,
--    ChannelGuestLandingPage -- Supabase Auth signup always happens
--    client-side, never inside an RPC, which never creates the auth.users
--    row itself), then calls accept_company_signup() from that fresh
--    session. That call creates the FIRST workspace_members row for the
--    new workspace, with is_workspace_admin = true -- the person who
--    requested their company's access becomes that company's own
--    workspace admin, the same relationship a Teams/Slack workspace
--    creator has to their own organization.
--
-- ============================================================
-- What "provisioned" means -- confirmed against the real, current gaps,
-- not assumed
-- ============================================================
-- Migration 162's own header explicitly flags this as unfinished and
-- names it as Stage 7's job: "No auto-seeding of a new workspace's own
-- section channels -- belongs to Stage 7's own reviewed provisioning
-- procedure." That is exactly this migration. approve_company_signup()
-- therefore does three things, not just "insert a workspaces row":
--   (a) creates the workspaces row itself;
--   (b) updates its company_branding row's placeholder name to the real
--       requested company name -- migration 182's own AFTER INSERT
--       trigger on workspaces (workspaces_seed_default_branding) already
--       creates this row automatically with a 'New Company' placeholder
--       the moment the workspaces INSERT below runs, discovered by this
--       migration's own canonical test (a first draft's redundant INSERT
--       collided with the trigger's own row on company_branding_pkey);
--   (c) seeds the 4 section channels (migration 101's own original seed
--       shape, reproduced here parameterized by the new workspace_id,
--       instead of the hardcoded single-workspace insert that migration
--       predates workspaces entirely).
-- Deliberately NOT seeded, per E's own 2026-09-22 decision that different
-- companies may be in entirely different industries (PRODUCT_ONBOARDING_
-- CONFIG.md's update, item 3): product_catalog, notification_rules,
-- standard_install_times, project_schedule_templates, proposal template
-- sections. All four are already correctly workspace-scoped (migrations
-- 173/176/177) and a workspace with zero rows in any of them is a
-- correct, honest "not configured yet" state per those tables' own RLS --
-- not a bug, and not something this migration copies in from the Ergon
-- Test Workspace's own real operational data. Flagged as a real, known
-- gap for a future pass, not silently skipped: a brand-new company today
-- has an empty catalog and no schedule templates until an admin builds
-- them, which is honest but not yet polished onboarding.
--
-- ============================================================
-- Why platform-admin-only approval, and why is_app_admin() specifically
-- ============================================================
-- E, 2026-09-22: "Self serve -- I must approve each company added right
-- now because we do not have a billing SaaS setup yet, so that will be
-- me." There is no per-workspace admin to check at request time (no
-- workspace exists yet), so this uses is_app_admin() -- the same global,
-- pre-workspace flag already used for genuinely platform-wide actions
-- throughout this schema (e.g. the legacy admin-role bridge functions,
-- migration 124), not a workspace-scoped check like
-- is_workspace_admin(workspace_id), which has no workspace to scope to
-- here.
--
-- ============================================================
-- A real, separate gap this migration's own canonical test surfaced,
-- fixed here rather than worked around
-- ============================================================
-- workspaces' own SELECT RLS (migration 115) is gated on
-- is_platform_admin() -- a DIFFERENT, newer flag (the platform_admins
-- table, migration 115) from the legacy is_app_admin()/app_admins this
-- migration's own approve/reject functions correctly use to match how
-- every other admin action in this app actually works today.
-- PRODUCT_ONBOARDING_CONFIG.md's own §1b finding already flagged that
-- "zero frontend or API code reads or writes any of it yet" -- meaning
-- platform_admins has likely never had a single row inserted into it in
-- production. Net effect, caught live by this migration's own test: an
-- app_admin (e.g. E's real account, per migration 133's bootstrap) could
-- approve a request (correctly authorized by is_app_admin()) but then
-- could not SELECT the workspaces row they just created, since
-- is_platform_admin() would say no. This is the first feature that
-- actually needs real platform-admin read access (browsing/managing
-- companies across the whole platform), so this migration closes the gap
-- honestly instead of leaving it: every existing app_admin is backfilled
-- into platform_admins below, idempotent, mirroring how migration 133
-- bootstrapped the first app_admin when that concept was introduced.

begin;

-- Idempotent backfill closing the gap described above -- every existing
-- app_admin also becomes a platform_admin, so they can actually see the
-- workspaces this migration's new functions let them create/manage.
insert into public.platform_admins (user_id)
select user_id from public.app_admins
on conflict (user_id) do nothing;

create table if not exists public.company_signup_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  requester_name text not null,
  requester_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_workspace_id uuid references public.workspaces(id) on delete set null,
  signup_token uuid unique,
  signup_token_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.company_signup_requests enable row level security;

-- Read/update restricted to the platform admin review queue -- no INSERT
-- policy for any client role at all. The only path in is
-- submit_company_signup_request() below, itself grantless (see that
-- function's own comment) -- reachable only via the API route's
-- service-role connection, which bypasses RLS entirely by design (the
-- same posture this schema already uses for every other service-role-only
-- write path, e.g. notifications since migration 114).
drop policy if exists "platform admin read company_signup_requests" on public.company_signup_requests;
create policy "platform admin read company_signup_requests" on public.company_signup_requests for select to authenticated
  using (public.is_app_admin(auth.uid()));

drop policy if exists "platform admin update company_signup_requests" on public.company_signup_requests;
create policy "platform admin update company_signup_requests" on public.company_signup_requests for update to authenticated
  using (public.is_app_admin(auth.uid()))
  with check (public.is_app_admin(auth.uid()));

revoke all on public.company_signup_requests from public;
revoke all on public.company_signup_requests from anon;

-- ============================================================
-- submit_company_signup_request -- the one function a prospect's request
-- ever reaches, and only via the API route's service-role connection
-- (see this file's header). No anon/authenticated grant exists at all --
-- this is deliberately NOT a browser-callable RPC, unlike
-- get_channel_guest_invite_by_token/get_company_signup_by_token below,
-- both of which ARE meant to be called directly from an anonymous
-- browser session (pure reads, no write, no abuse surface beyond a
-- lookup). A write with no rate limiting attached would be a real open
-- spam vector if it were anon-callable directly.
-- ============================================================

create or replace function public.submit_company_signup_request(
  p_company_name text,
  p_requester_name text,
  p_requester_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_name text := btrim(coalesce(p_company_name, ''));
  v_requester_name text := btrim(coalesce(p_requester_name, ''));
  v_requester_email text := lower(btrim(coalesce(p_requester_email, '')));
  v_id uuid;
begin
  if char_length(v_company_name) = 0 or char_length(v_company_name) > 200 then
    raise exception 'company_name must be between 1 and 200 characters';
  end if;
  if char_length(v_requester_name) = 0 or char_length(v_requester_name) > 200 then
    raise exception 'requester_name must be between 1 and 200 characters';
  end if;
  if v_requester_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_requester_email) > 320 then
    raise exception 'requester_email is not a valid-looking email address';
  end if;

  insert into public.company_signup_requests (company_name, requester_name, requester_email)
  values (v_company_name, v_requester_name, v_requester_email)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_company_signup_request(text, text, text) from public;
revoke execute on function public.submit_company_signup_request(text, text, text) from anon;
revoke execute on function public.submit_company_signup_request(text, text, text) from authenticated;

-- ============================================================
-- guard_channel_workspace_id_mutation -- redefined, not a new function.
-- Migration 162's original body (reproduced verbatim below except for
-- the one new branch) unconditionally resolves a section/group channel's
-- workspace_id from the CALLER's own membership on every INSERT --
-- correct for the normal case this trigger exists for (a real signed-in
-- member creating a channel in their own workspace, never trusting a
-- caller-supplied value), but it has no way to distinguish that from
-- approve_company_signup's own, fundamentally different need: a trusted,
-- is_app_admin()-gated procedure provisioning a brand-new workspace's
-- default channels on behalf of a company that has no members at all
-- yet. Per this repo's own standing discipline, an applied migration
-- file is never edited -- an old function's behavior is corrected by
-- redefining it in a later migration instead (the same pattern already
-- used for bump_conversation_last_message_at, migration 190).
--
-- The escape hatch: a transaction-local Postgres setting
-- (app.provisioning_workspace_id, set via set_config(..., true) --
-- local-scoped, auto-reverts at the end of the current transaction,
-- exactly the same mechanism this whole schema already relies on for
-- request.jwt.claims/role per PostgREST request). This is safe because
-- (a) no client-facing RPC or REST surface can call set_config directly
-- -- PostgREST only ever invokes declared functions, never arbitrary
-- SQL, so the ONLY code path that can ever set this value is
-- approve_company_signup itself; (b) approve_company_signup is already
-- gated on is_app_admin(), so only a real platform admin's approval can
-- ever cause this branch to fire at all; and (c) the value it sets is
-- always a workspace_id that function's own preceding statement just
-- created in the SAME transaction, never anything derived from raw
-- caller input.
-- ============================================================

create or replace function public.guard_channel_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provisioning_workspace_id text;
begin
  if TG_OP = 'INSERT' then
    if new.type = 'project' then
      new.workspace_id := (select workspace_id from public.projects where id = new.project_id);
    elsif new.type = 'client' then
      new.workspace_id := (select workspace_id from public.clients where id = new.client_id);
    else
      -- section/group: never trust a caller-supplied value, same
      -- fail-closed posture as guard_workspace_id_mutation() -- UNLESS
      -- the one trusted provisioning path above set the escape-hatch GUC
      -- for exactly this workspace_id this transaction.
      v_provisioning_workspace_id := nullif(current_setting('app.provisioning_workspace_id', true), '');
      if v_provisioning_workspace_id is not null and v_provisioning_workspace_id = new.workspace_id::text then
        return new;
      end if;
      new.workspace_id := public.resolve_caller_workspace_id();
    end if;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_channel_workspace_id_mutation() from public;

-- ============================================================
-- approve_company_signup -- platform-admin-only. Provisions a real,
-- immediately workspace-scoped-and-isolated company (see this file's
-- header for exactly what that means) and issues the accept token.
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
  if not public.is_app_admin(auth.uid()) then
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

  insert into public.workspaces (name, slug, status)
  values (v_request.company_name, v_slug, 'active')
  returning id into v_workspace_id;

  -- Migration 182's own workspaces_seed_default_branding AFTER INSERT
  -- trigger already fired synchronously above, creating a
  -- company_branding row with a 'New Company' placeholder name -- an
  -- explicit insert here would collide with it (caught by this
  -- migration's own canonical test). Update that seeded row to the real
  -- requested company name instead of inserting a second one.
  update public.company_branding set company_name = v_request.company_name where workspace_id = v_workspace_id;

  -- Migration 162's own guard_channel_workspace_id_mutation() trigger
  -- unconditionally overrides a section/group channel's workspace_id
  -- with resolve_caller_workspace_id() on INSERT -- correct for every
  -- normal, user-initiated channel creation this trigger was built for,
  -- but it means the caller-supplied v_workspace_id below would silently
  -- be replaced with the APPROVING ADMIN's own workspace instead (caught
  -- live by this migration's own canonical test -- the insert appeared
  -- to succeed with zero errors, but the rows landed in the wrong
  -- workspace and were silently absorbed by the real workspace's own
  -- existing section channels via ON CONFLICT DO NOTHING). See this
  -- function's own trigger redefinition below for the fix.
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
      signup_token = v_token
  where id = p_request_id;

  return jsonb_build_object('workspace_id', v_workspace_id, 'signup_token', v_token);
end;
$$;

revoke all on function public.approve_company_signup(uuid) from public;
revoke execute on function public.approve_company_signup(uuid) from anon;
grant execute on function public.approve_company_signup(uuid) to authenticated;

-- ============================================================
-- reject_company_signup -- platform-admin-only.
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
  if not public.is_app_admin(auth.uid()) then
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
-- get_company_signup_by_token -- anon-callable, read-only, same shape as
-- get_channel_guest_invite_by_token (migration 188): the accept-landing
-- page needs to show "you're joining <Company>" before the prospect has
-- signed in at all. Returns zero rows for an invalid, unapproved,
-- already-used, or unknown token -- never an error, matching the
-- safe-empty posture every other anon lookup in this schema already has.
-- ============================================================

create or replace function public.get_company_signup_by_token(p_token uuid)
returns table (company_name text)
language sql
security definer
stable
set search_path = ''
as $$
  select r.company_name
  from public.company_signup_requests r
  where r.signup_token = p_token
    and r.status = 'approved'
    and r.signup_token_used_at is null;
$$;

revoke all on function public.get_company_signup_by_token(uuid) from public;
grant execute on function public.get_company_signup_by_token(uuid) to anon;
grant execute on function public.get_company_signup_by_token(uuid) to authenticated;

-- ============================================================
-- accept_company_signup -- authenticated only, called from the prospect's
-- own freshly-created session (same deferred-application pattern as
-- accept_invite/accept_channel_guest_invite -- Supabase Auth signup
-- always happens client-side, never inside this function). Creates the
-- FIRST workspace_members row for the new workspace, with
-- is_workspace_admin = true.
-- ============================================================

create or replace function public.accept_company_signup(p_token uuid)
-- Named joined_workspace_id, not workspace_id -- an OUT parameter named
-- workspace_id would be in scope as a plain identifier throughout this
-- whole function body (PL/pgSQL's normal OUT-parameter behavior), making
-- `on conflict (workspace_id, user_id)` below ambiguous between this
-- function's own return column and workspace_members' real column of the
-- same name. Caught live by this migration's own canonical test -- the
-- same class of unqualified-identifier hazard migration 105's own header
-- already warns about ("learned the hard way in migration 103").
returns table (outcome text, joined_workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.company_signup_requests;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to accept a company signup';
  end if;

  select * into v_request
  from public.company_signup_requests
  where signup_token = p_token
    and status = 'approved'
    and signup_token_used_at is null
  for update;

  if v_request.id is null then
    return query select 'not_found_or_already_used'::text, null::uuid;
    return;
  end if;

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

-- Phase 3, cross-cutting cleanup -- approved by E under the same
-- 2026-09-16 standing authorization as migrations 155-157. Retires
-- active_workspace_id() (migration 124, "exactly one workspace in the
-- whole database") from every RPC where it was standing in for real
-- per-entity workspace resolution, now that BOTH projects.workspace_id
-- (migration 156) and sales_quotes.workspace_id (migration 117) are
-- live and confirmed in production -- flagged as this exact next step
-- in migration 155's own header and migration 157's own header,
-- explicitly deferred from both for a focused pass. Not bundled into
-- Stage 1 or Stage 2's own migrations on purpose: this touches code
-- SHARED between Submittals (Stage 2) and Proposals (Stage 1), so it
-- could not correctly ship as part of either stage alone.
--
-- While fixing each function's active_workspace_id() call, a second,
-- related, and more serious gap was found by direct read and fixed in
-- the same pass, not left for later: every one of the 7 share-link
-- lifecycle RPCs below (create_submittal_share_token,
-- create_quote_proposal_share_token, regenerate_share_link,
-- disable_share_link, re_enable_share_link,
-- permanently_revoke_share_link -- plus create_and_send_quote_
-- proposal_version, covered for completeness though it is not directly
-- reachable, see below) checks the caller's ROLE
-- (assert_can_manage_share_link: Sales/manager/admin for proposals,
-- PM/admin for submittals) but never checks the caller's WORKSPACE
-- against the target entity's own workspace -- the exact T2-class gap
-- already found and fixed for other RPCs in migrations 155/157. Two of
-- these seven (create_submittal_share_token,
-- create_quote_proposal_share_token) are directly callable by any
-- authenticated PM/admin or Sales/manager/admin with no workspace check
-- at all today -- confirmed still granted to `authenticated`
-- (migration 138), even though migration 144's own trace confirmed the
-- frontend no longer calls either one (superseded by the create_and_
-- send_* functions) -- "not called by the current frontend" is not the
-- same guarantee as "not callable," and this migration closes the
-- latter regardless of the former.
--
-- create_and_send_quote_proposal_version is the one exception covered
-- here for completeness rather than urgency: migration 147 already
-- revoked its direct `authenticated` execute grant, so it is reachable
-- ONLY through request_or_send_quote_proposal_version() (migration 155),
-- which already validates the caller's workspace against the target
-- quote's workspace before ever calling this inner function -- the gap
-- fixed here is defense-in-depth on an already-protected path, not a
-- currently-exploitable one. Its active_workspace_id() call is fixed
-- because this migration is already touching the function for the
-- containment check, and leaving a known, related gap in the same
-- function body while editing it for something else would be
-- inconsistent with this session's own discipline (matching how
-- migration 157 fixed create_and_send_submittal_version's identical
-- active_workspace_id() call in the same pass that added its
-- containment check).
--
-- Design: two new shared helper functions.
--   - share_link_entity_workspace_id(p_entity_type, p_entity_id) --
--     resolves the real workspace_id for either entity type, via the
--     same join shape already proven in get_submittal_by_token/
--     get_quote_proposal_by_token (migration 157/145).
--   - assert_share_link_in_caller_workspace(p_entity_type, p_entity_id)
--     -- calls the above, compares against resolve_caller_workspace_id()
--     (the same function powering every other Phase 3 containment check
--     this session, migrations 146/155/157), raises EC002 on mismatch.
-- Both are called alongside the EXISTING assert_can_manage_share_link()
-- role check, not instead of it -- the "alongside, not instead of"
-- principle T2 established, applied here to a fifth and sixth RPC
-- family.
--
-- Confirm 158 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- shared helper functions.
-- ============================================================

create or replace function public.share_link_entity_workspace_id(p_entity_type text, p_entity_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_entity_type = 'project_submittal' then
    return (
      select p.workspace_id
      from public.project_submittals s
      join public.projects p on p.id = s.project_id
      where s.id = p_entity_id
    );
  elsif p_entity_type = 'sales_quote_proposal' then
    return (
      select q.workspace_id
      from public.sales_quote_proposals sp
      join public.sales_quotes q on q.id = sp.quote_id
      where sp.id = p_entity_id
    );
  else
    return null;
  end if;
end;
$$;

revoke execute on function public.share_link_entity_workspace_id(text, uuid) from public;
grant execute on function public.share_link_entity_workspace_id(text, uuid) to authenticated;

create or replace function public.assert_share_link_in_caller_workspace(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_workspace_id uuid;
  v_caller_workspace_id uuid;
begin
  v_entity_workspace_id := public.share_link_entity_workspace_id(p_entity_type, p_entity_id);
  v_caller_workspace_id := public.resolve_caller_workspace_id();
  if v_entity_workspace_id is distinct from v_caller_workspace_id then
    raise exception 'This share link does not belong to your workspace.' using errcode = 'EC002';
  end if;
end;
$$;

revoke all on function public.assert_share_link_in_caller_workspace(text, uuid) from public;
revoke execute on function public.assert_share_link_in_caller_workspace(text, uuid) from anon;
grant execute on function public.assert_share_link_in_caller_workspace(text, uuid) to authenticated;

-- ============================================================
-- Section 2 -- create_submittal_share_token / create_quote_proposal_
-- share_token (migration 138): each gains the workspace-containment
-- check (using the known literal entity_type and the caller-supplied
-- id, before the entity exists as a share token -- the underlying
-- submittal/proposal row itself already exists, confirmed by the
-- pre-existing existence check just above), and each replaces its own
-- active_workspace_id() call with the same value the containment
-- helper already resolves.
-- ============================================================

create or replace function public.create_submittal_share_token(p_submittal_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_default_expiration interval;
  v_token text;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('pm')) then
    raise exception 'Only a PM or admin may create a share link for a submittal.' using errcode = 'EC001';
  end if;

  if not exists (select 1 from public.project_submittals where id = p_submittal_id) then
    raise exception 'This submittal could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_share_link_in_caller_workspace('project_submittal', p_submittal_id);
  v_workspace_id := public.share_link_entity_workspace_id('project_submittal', p_submittal_id);

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = v_workspace_id;

  v_token := public.generate_share_token();

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'project_submittal', p_submittal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'project_submittal', p_submittal_id, 'created', auth.uid(), (select email from auth.users where id = auth.uid()));

  return v_token;
end;
$$;

revoke all on function public.create_submittal_share_token(uuid) from public;
revoke execute on function public.create_submittal_share_token(uuid) from anon;
grant execute on function public.create_submittal_share_token(uuid) to authenticated;

create or replace function public.create_quote_proposal_share_token(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_default_expiration interval;
  v_token text;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may create a share link for a proposal.' using errcode = 'EC001';
  end if;

  if not exists (select 1 from public.sales_quote_proposals where id = p_proposal_id) then
    raise exception 'This proposal could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_share_link_in_caller_workspace('sales_quote_proposal', p_proposal_id);
  v_workspace_id := public.share_link_entity_workspace_id('sales_quote_proposal', p_proposal_id);

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = v_workspace_id;

  v_token := public.generate_share_token();

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'sales_quote_proposal', p_proposal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'sales_quote_proposal', p_proposal_id, 'created', auth.uid(), (select email from auth.users where id = auth.uid()));

  return v_token;
end;
$$;

revoke all on function public.create_quote_proposal_share_token(uuid) from public;
revoke execute on function public.create_quote_proposal_share_token(uuid) from anon;
grant execute on function public.create_quote_proposal_share_token(uuid) to authenticated;

-- ============================================================
-- Section 3 -- disable_share_link / re_enable_share_link /
-- permanently_revoke_share_link (migration 139): each gains the
-- workspace-containment check, called alongside the existing
-- assert_can_manage_share_link(v_entity_type) role check. None of
-- these three call active_workspace_id() -- containment is the only
-- fix needed here.
-- ============================================================

create or replace function public.disable_share_link(p_token text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_updated boolean := false;
begin
  select entity_type, entity_id into v_entity_type, v_entity_id
  from public.public_share_tokens where token = p_token;

  if v_entity_type is null then
    raise exception 'This share link could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_can_manage_share_link(v_entity_type);
  perform public.assert_share_link_in_caller_workspace(v_entity_type, v_entity_id);

  update public.public_share_tokens
  set status = 'temporarily_disabled', disabled_at = now(), disabled_by = auth.uid(), disabled_reason = p_reason
  where token = p_token and status = 'active';
  get diagnostics v_updated = row_count;

  if not v_updated then
    return 'already_not_active';
  end if;

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email, reason)
  values (p_token, v_entity_type, v_entity_id, 'temporarily_disabled', auth.uid(), (select email from auth.users where id = auth.uid()), p_reason);

  return 'success';
end;
$$;

revoke all on function public.disable_share_link(text, text) from public;
revoke execute on function public.disable_share_link(text, text) from anon;
grant execute on function public.disable_share_link(text, text) to authenticated;

create or replace function public.re_enable_share_link(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_updated boolean := false;
begin
  select entity_type, entity_id into v_entity_type, v_entity_id
  from public.public_share_tokens where token = p_token;

  if v_entity_type is null then
    raise exception 'This share link could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_can_manage_share_link(v_entity_type);
  perform public.assert_share_link_in_caller_workspace(v_entity_type, v_entity_id);

  update public.public_share_tokens
  set status = 'active', disabled_at = null, disabled_by = null, disabled_reason = null
  where token = p_token and status = 'temporarily_disabled';
  get diagnostics v_updated = row_count;

  if not v_updated then
    return 'already_not_disabled';
  end if;

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (p_token, v_entity_type, v_entity_id, 're_enabled', auth.uid(), (select email from auth.users where id = auth.uid()));

  return 'success';
end;
$$;

revoke all on function public.re_enable_share_link(text) from public;
revoke execute on function public.re_enable_share_link(text) from anon;
grant execute on function public.re_enable_share_link(text) to authenticated;

create or replace function public.permanently_revoke_share_link(p_token text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_updated boolean := false;
begin
  select entity_type, entity_id into v_entity_type, v_entity_id
  from public.public_share_tokens where token = p_token;

  if v_entity_type is null then
    raise exception 'This share link could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_can_manage_share_link(v_entity_type);
  perform public.assert_share_link_in_caller_workspace(v_entity_type, v_entity_id);

  update public.public_share_tokens
  set status = 'permanently_revoked', revoked_at = now(), revoked_by = auth.uid(), revoked_reason = p_reason
  where token = p_token and status in ('active', 'temporarily_disabled');
  get diagnostics v_updated = row_count;

  if not v_updated then
    return 'already_terminal';
  end if;

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email, reason)
  values (p_token, v_entity_type, v_entity_id, 'permanently_revoked', auth.uid(), (select email from auth.users where id = auth.uid()), p_reason);

  return 'success';
end;
$$;

revoke all on function public.permanently_revoke_share_link(text, text) from public;
revoke execute on function public.permanently_revoke_share_link(text, text) from anon;
grant execute on function public.permanently_revoke_share_link(text, text) to authenticated;

-- ============================================================
-- Section 4 -- regenerate_share_link (migration 139): gains the
-- workspace-containment check, and replaces active_workspace_id() with
-- the same value the containment helper already resolves (no double
-- lookup).
-- ============================================================

create or replace function public.regenerate_share_link(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_workspace_id uuid;
  v_new_token text;
  v_default_expiration interval;
  v_updated boolean := false;
begin
  select entity_type, entity_id into v_entity_type, v_entity_id
  from public.public_share_tokens where token = p_token;

  if v_entity_type is null then
    raise exception 'This share link could not be found.' using errcode = 'EC003';
  end if;

  perform public.assert_can_manage_share_link(v_entity_type);
  perform public.assert_share_link_in_caller_workspace(v_entity_type, v_entity_id);
  v_workspace_id := public.share_link_entity_workspace_id(v_entity_type, v_entity_id);

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = v_workspace_id;

  v_new_token := public.generate_share_token();

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_new_token, v_entity_type, v_entity_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  update public.public_share_tokens
  set status = 'superseded', superseded_by_token = v_new_token
  where token = p_token and status in ('active', 'temporarily_disabled');
  get diagnostics v_updated = row_count;

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_new_token, v_entity_type, v_entity_id, 'created', auth.uid(), (select email from auth.users where id = auth.uid()));
  if v_updated then
    insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
    values (p_token, v_entity_type, v_entity_id, 'superseded', auth.uid(), (select email from auth.users where id = auth.uid()));
  end if;

  return v_new_token;
end;
$$;

revoke all on function public.regenerate_share_link(text) from public;
revoke execute on function public.regenerate_share_link(text) from anon;
grant execute on function public.regenerate_share_link(text) to authenticated;

-- ============================================================
-- Section 5 -- create_and_send_quote_proposal_version (migration 140):
-- defense-in-depth only (see this file's header for why it is not
-- currently reachable except through the already-protected
-- request_or_send_quote_proposal_version wrapper). Replaces its
-- active_workspace_id() call with the quote's own already-known
-- workspace_id -- the existence check just above already confirms the
-- quote exists; this reads its workspace_id in the same query instead
-- of a second lookup.
-- ============================================================

create or replace function public.create_and_send_quote_proposal_version(
  p_quote_id uuid,
  p_content_snapshot jsonb,
  p_client_name text,
  p_client_email text
)
returns table (proposal_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_proposal_id uuid;
  v_token text;
  v_default_expiration interval;
  v_actor_email text;
  v_workspace_id uuid;
  r record;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may create and send a proposal version.' using errcode = 'EC001';
  end if;

  select workspace_id into v_workspace_id from public.sales_quotes where id = p_quote_id;
  if not found then
    raise exception 'This quote could not be found.' using errcode = 'EC003';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.sales_quote_proposals where quote_id = p_quote_id;

  insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email, sent_at)
  values (p_quote_id, v_next_version, 'sent', coalesce(p_content_snapshot, '{}'::jsonb), p_client_name, p_client_email, now())
  returning id into v_proposal_id;

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = v_workspace_id;

  v_token := public.generate_share_token();
  v_actor_email := (select email from auth.users where id = auth.uid());

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'sales_quote_proposal', v_proposal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'sales_quote_proposal', v_proposal_id, 'created', auth.uid(), v_actor_email);

  for r in
    select t.token as old_token, t.entity_id as old_entity_id
    from public.public_share_tokens t
    join public.sales_quote_proposals p on p.id = t.entity_id
    where t.entity_type = 'sales_quote_proposal'
      and p.quote_id = p_quote_id
      and p.id <> v_proposal_id
      and t.status in ('active', 'temporarily_disabled')
  loop
    update public.public_share_tokens as pst
    set status = 'superseded', superseded_by_token = v_token
    where pst.token = r.old_token;

    insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
    values (r.old_token, 'sales_quote_proposal', r.old_entity_id, 'superseded', auth.uid(), v_actor_email);
  end loop;

  return query select v_proposal_id, v_token;
end;
$$;

-- Grant posture unchanged from migration 147: no direct authenticated
-- grant, only reachable via request_or_send_quote_proposal_version().
revoke all on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from public;
revoke execute on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from anon;
revoke execute on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - active_workspace_id() itself is NOT dropped or altered. It
--     remains in active use by the legacy admin-role bridge functions
--     (migration 124) and by save_equipment_recipe()/
--     replace_project_bom_lines() (migrations 130/131) for
--     equipment_types, which does not have its own workspace_id yet --
--     that lands in a later table group (Purchasing/Inventory, Stage 3,
--     or wherever equipment_types is ultimately scoped). Every call
--     site this migration COULD safely retire (both projects and
--     sales_quotes now having real workspace_id) has been retired;
--     every remaining call site genuinely still needs it.
--   - No change to any table's RLS policy -- this migration is entirely
--     RPC-layer hardening, the same "belt and suspenders beyond RLS"
--     category as migrations 155/157's own RPC sections.
--   - No change to which roles may manage which entity type
--     (assert_can_manage_share_link itself is untouched) -- only the
--     workspace dimension is added, alongside the existing role gate,
--     never replacing it.
-- ============================================================

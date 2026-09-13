-- Queue C2.4 (2026-09-13): atomic share-link lifecycle actions (disable,
-- re-enable, permanently revoke, regenerate/supersede) plus the matching
-- read/response outcome extension. Requires migrations 137 and 138 to be
-- live first. Ships the enforcement, the action RPCs, and the outcome
-- distinctions together in one migration, per the task's own instruction
-- -- no window where a control exists but public access is unaffected, or
-- vice versa.
--
-- Full design: PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md Part 8
-- items 3/4 (disable reversibility, dead-link wording) and Part 9.1 item 5.
-- Confirm 139 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Shared authorization helper: who may manage a share link, given its
-- entity_type. Mirrors migration 138's own per-entity authorization
-- exactly (Sales/manager/admin for proposals, PM/admin for submittals) --
-- centralized here since all four lifecycle actions below need the
-- identical check, and duplicating it four times would risk one copy
-- drifting from the others.
-- ============================================================

create or replace function public.assert_can_manage_share_link(p_entity_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_entity_type = 'sales_quote_proposal' then
    if not (public.is_app_admin(auth.uid()) or public.has_role('sales') or public.has_role('manager')) then
      raise exception 'Only Sales, a manager, or an admin may manage a proposal share link.' using errcode = 'EC001';
    end if;
  elsif p_entity_type = 'project_submittal' then
    if not (public.is_app_admin(auth.uid()) or public.has_role('pm')) then
      raise exception 'Only a PM or admin may manage a submittal share link.' using errcode = 'EC001';
    end if;
  else
    raise exception 'Unknown share-link entity type.' using errcode = 'EC003';
  end if;
end;
$$;

revoke all on function public.assert_can_manage_share_link(text) from public;
revoke execute on function public.assert_can_manage_share_link(text) from anon;
grant execute on function public.assert_can_manage_share_link(text) to authenticated;

-- ============================================================
-- disable_share_link / re_enable_share_link -- Part 8 item 3's "one
-- control pair", both fully reversible between each other. The WHERE
-- guard on each UPDATE is the first-writer-safe predicate: only a token
-- actually in the expected starting state is matched, so two concurrent
-- clicks (or a stale second click after the state already changed)
-- produce one real transition and one honestly-reported no-op, never a
-- double-logged or corrupted state.
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

  -- Only ever matches a currently temporarily_disabled row -- a
  -- permanently_revoked or superseded token can never be re-enabled
  -- through this function, by construction (not merely by convention),
  -- matching Part 8 item 3's "no Re-enable is possible" requirement for
  -- those two states.
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

-- ============================================================
-- permanently_revoke_share_link -- Part 8 item 3's separate, deliberate,
-- confirmation-gated action (the confirmation step itself is a frontend
-- concern, C2.6). Can be reached from 'active' OR 'temporarily_disabled'
-- -- either way, once revoked, the WHERE guards on disable/re-enable above
-- can never again match this row (its status is neither 'active' nor
-- 'temporarily_disabled' afterward), so "no Re-enable is possible" holds
-- structurally, not just by the frontend choosing not to offer the button.
-- ============================================================

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
-- regenerate_share_link -- creates a fresh token for the SAME entity and
-- marks the old one 'superseded', linked via superseded_by_token. Reuses
-- the exact same server-side generation and open-document-default
-- expiration logic as migration 138's creation RPCs (not duplicated --
-- calls generate_share_token() and reads workspace_share_link_settings
-- the same way) so a regenerated link is generated exactly as rigorously
-- as a brand-new one.
--
-- Scope note, decided here: this function is for SUPERSESSION (Queue
-- C2.5's "a newer version was sent" auto-flow) -- NOT the manual
-- "Permanently Revoke & Generate New Link" UI button (Part 9.3). That
-- button's own two actions are semantically different (revoked = a dead
-- end, unrelated to any replacement; superseded = the new token
-- specifically replaces this one) and is built in C2.6 as two separate
-- calls -- permanently_revoke_share_link, then a plain
-- create_*_share_token -- not this function. Recorded explicitly so a
-- later coder doesn't wire the revoke button to this one by mistake.
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

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = public.active_workspace_id();

  v_new_token := public.generate_share_token();

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_new_token, v_entity_type, v_entity_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  -- Only supersedes the old token if it was still active or temporarily
  -- disabled -- an already permanently_revoked or already-superseded
  -- token is left exactly as it was (its own terminal state is not
  -- overwritten), even though a brand-new token was still just created
  -- for the entity. This mirrors the same first-writer-safe guard as
  -- every other transition above.
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
-- get_quote_proposal_by_token -- redefined to add the `outcome` column
-- the decided three-tier dead-link model needs: 'found' (unchanged
-- success case), 'invalid_token' (the token never existed at all --
-- today's existing generic case), 'expired', 'superseded', 'unavailable'
-- (covers BOTH temporarily_disabled and permanently_revoked under one
-- neutral outcome, per Part 8 item 4's explicit "the client is never told
-- which"). This is a real signature change from migration 119/121's
-- version (a new leading `outcome` column) -- the frontend's
-- fetchPublicQuoteProposal/PublicQuoteProposalResult parsing must be
-- updated in the SAME reviewed code batch that ships this migration, not
-- separately, or the app would stop understanding this RPC's response
-- shape entirely.
-- ============================================================

drop function if exists public.get_quote_proposal_by_token(text);

create function public.get_quote_proposal_by_token(share_token text)
returns table (
  outcome text,
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  responded_at timestamptz,
  approval_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_status text;
  v_expires_at timestamptz;
  v_id uuid;
  v_status text;
  v_version integer;
  v_content_snapshot jsonb;
  v_client_name text;
  v_responded_at timestamptz;
  v_approval_name text;
begin
  select t.status, t.expires_at, p.id, p.status, p.version, p.content_snapshot, p.client_name, p.responded_at, p.approval_name
  into v_token_status, v_expires_at, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_responded_at, v_approval_name
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token and t.entity_type = 'sales_quote_proposal';

  if v_token_status is null then
    return query select 'invalid_token'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_token_status = 'superseded' then
    return query select 'superseded'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_expires_at is not null and v_expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_responded_at, v_approval_name;
end;
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
revoke execute on function public.get_quote_proposal_by_token(text) from authenticated;
grant execute on function public.get_quote_proposal_by_token(text) to anon;

-- ============================================================
-- get_submittal_by_token -- identical outcome extension, submittal side.
-- ============================================================

drop function if exists public.get_submittal_by_token(text);

create function public.get_submittal_by_token(share_token text)
returns table (
  outcome text,
  submittal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  project_name text,
  responded_at timestamptz,
  approval_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_status text;
  v_expires_at timestamptz;
  v_id uuid;
  v_status text;
  v_version integer;
  v_content_snapshot jsonb;
  v_client_name text;
  v_project_name text;
  v_responded_at timestamptz;
  v_approval_name text;
begin
  select t.status, t.expires_at, s.id, s.status, s.version, s.content_snapshot, s.client_name, p.project_name, s.responded_at, s.approval_name
  into v_token_status, v_expires_at, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_project_name, v_responded_at, v_approval_name
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  join public.projects p on p.id = s.project_id
  where t.token = share_token and t.entity_type = 'project_submittal';

  if v_token_status is null then
    return query select 'invalid_token'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_token_status = 'superseded' then
    return query select 'superseded'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_expires_at is not null and v_expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_project_name, v_responded_at, v_approval_name;
end;
$$;

revoke all on function public.get_submittal_by_token(text) from public;
revoke execute on function public.get_submittal_by_token(text) from authenticated;
grant execute on function public.get_submittal_by_token(text) to anon;

-- ============================================================
-- respond_to_quote_proposal -- same outcome extension, plus (per the
-- task's own instruction) "a disabled/revoked/expired/superseded link may
-- never submit a response." Preserves migration 121's own two real bug
-- fixes (the ambiguous-column alias and the partial-index ON CONFLICT
-- clause) verbatim -- only the new token-status/expiration pre-check is
-- added, ahead of the existing 'sent'-status UPDATE guard.
-- ============================================================

create or replace function public.respond_to_quote_proposal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text
)
returns table (
  outcome text,
  status text,
  responded_at timestamptz,
  approval_name text,
  version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  snapshot jsonb;
  target_quote_id uuid;
  token_status text;
  token_expires_at timestamptz;
  updated_status text;
  updated_responded_at timestamptz;
  updated_approval_name text;
  updated_version integer;
  current_status text;
  current_responded_at timestamptz;
  current_approval_name text;
  current_version integer;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  select t.status, t.expires_at, p.id, p.content_snapshot, p.quote_id
  into token_status, token_expires_at, target_id, snapshot, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal';

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  update public.sales_quote_proposals as sqp
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where sqp.id = target_id
    and sqp.status = 'sent'
  returning sqp.status, sqp.responded_at, sqp.approval_name, sqp.version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    select sqp.status, sqp.responded_at, sqp.approval_name, sqp.version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.sales_quote_proposals as sqp
    where sqp.id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  -- Completed-document retention transition (Part 8 item 5): a document
  -- that just received a real response extends its own link's
  -- expiration to the workspace's longer completed-document default,
  -- rather than staying on the shorter open-document window it was
  -- created with. Best-effort -- if no settings row resolves for any
  -- reason, the link simply keeps whatever expiration it already had;
  -- this must never block a real, successful response from completing.
  begin
    update public.public_share_tokens
    set expires_at = now() + (
      select default_expiration_completed_documents from public.workspace_share_link_settings
      where workspace_id = public.active_workspace_id()
    )
    where token = share_token;
  exception when others then
    null;
  end;

  select q.created_by_email, q.site_name into owner_email, quote_site_name
  from public.sales_quotes q where q.id = target_quote_id;

  select is_active into rule_active from public.notification_rules where event_type = 'quote_proposal_responded';

  if owner_email is not null and coalesce(rule_active, false) then
    insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
    values (
      owner_email,
      'quote_proposal_responded',
      'Proposal ' || replace(new_status, '_', ' '),
      coalesce(quote_site_name, 'A quote') || ' proposal v' || updated_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
      'sales_quote_proposal',
      target_id::text,
      'quote_proposal_responded:' || target_id::text || ':' || new_status
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_quote_proposal(text, text, text, text, text) from public;
revoke execute on function public.respond_to_quote_proposal(text, text, text, text, text) from authenticated;
grant execute on function public.respond_to_quote_proposal(text, text, text, text, text) to anon;

-- ============================================================
-- respond_to_submittal -- identical outcome extension and completed-
-- document retention transition, submittal side. Notification loop
-- unchanged from migration 122.
-- ============================================================

create or replace function public.respond_to_submittal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text
)
returns table (
  outcome text,
  status text,
  responded_at timestamptz,
  approval_name text,
  version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_project_id uuid;
  token_status text;
  token_expires_at timestamptz;
  updated_status text;
  updated_responded_at timestamptz;
  updated_approval_name text;
  updated_version integer;
  current_status text;
  current_responded_at timestamptz;
  current_approval_name text;
  current_version integer;
  project_label text;
  rule_active boolean;
  recipient record;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid submittal response status';
  end if;

  select t.status, t.expires_at, s.id, s.project_id
  into token_status, token_expires_at, target_id, target_project_id
  from public.public_share_tokens t
  join public.project_submittals s on s.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'project_submittal';

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  update public.project_submittals as ps
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(ps.content_snapshot::text::bytea), 'hex'),
      updated_at = now()
  where ps.id = target_id
    and ps.status = 'sent'
  returning ps.status, ps.responded_at, ps.approval_name, ps.version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    select ps.status, ps.responded_at, ps.approval_name, ps.version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.project_submittals as ps
    where ps.id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  begin
    update public.public_share_tokens
    set expires_at = now() + (
      select default_expiration_completed_documents from public.workspace_share_link_settings
      where workspace_id = public.active_workspace_id()
    )
    where token = share_token;
  exception when others then
    null;
  end;

  select p.project_name into project_label from public.projects p where p.id = target_project_id;

  select is_active into rule_active from public.notification_rules where event_type = 'submittal_responded';

  if coalesce(rule_active, false) then
    for recipient in
      select email from public.get_users_by_role('pm')
      union
      select email from public.get_admin_emails()
    loop
      insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
      values (
        recipient.email,
        'submittal_responded',
        'Submittal ' || replace(new_status, '_', ' '),
        coalesce(project_label, 'A project') || ' submittal v' || updated_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
        'project_submittal',
        target_id::text,
        'submittal_responded:' || target_id::text || ':' || new_status || ':' || recipient.email
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_submittal(text, text, text, text, text) from public;
revoke execute on function public.respond_to_submittal(text, text, text, text, text) from authenticated;
grant execute on function public.respond_to_submittal(text, text, text, text, text) to anon;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - The frontend still parses the OLD (no-`outcome`-column) RPC
--     response shapes. Updating PublicQuoteProposalResult/
--     PublicSubmittalResult/ProposalResponseOutcome and the two
--     ProposalPublicPage/SubmittalPublicPage components to branch on the
--     new outcome values, and writing the three decided dead-link
--     messages, is a separate, code-only change reviewed and shipped in
--     the SAME batch as this migration (per this task's own "ship
--     together" instruction) -- but it is still a distinct git commit
--     from this SQL file, applied only after E confirms this migration
--     and its test both succeeded.
--   - Manager/admin override with a mandatory reason field, and the
--     capability system generally, remain out of scope (Stage 2) --
--     the `reason` parameter on disable/revoke here is optional, not
--     enforced non-null, matching migration 137's own schema note on
--     why a mandatory-reason constraint would be inventing a rule for
--     the non-override case that was never actually decided.
-- ============================================================

commit;

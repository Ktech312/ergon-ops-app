-- 2026-10-04 functional walkthrough: a client could NOT approve, reject, or
-- request a revision on a Sales proposal whenever the proposal's frozen
-- content_snapshot contained a backslash -- which any snapshot with a
-- double quote in it does (JSON writes \" for a quote), e.g. every catalog
-- item named like 55" Display Kiosk, or a description with HTML attributes.
-- Production symptom: the public proposal page said "Could not submit your
-- response" and /api/respond-to-proposal logged
--   RPC failed: HTTP 400: 22P02 invalid input syntax for type bytea
-- Root cause: approval_content_hash was computed as
-- sha256(snapshot::text::bytea). Casting arbitrary text to bytea parses it
-- as bytea ESCAPE syntax, where a backslash must introduce a valid escape
-- (a doubled backslash or a 3-digit octal code), so any other backslash throws. The correct way to hash the
-- text's bytes is convert_to(text, 'UTF8') -- identical bytes for every
-- snapshot that used to work (no backslash), and now also correct for the
-- ones that never could. Same defect existed in respond_to_submittal (a
-- submittal's content_snapshot carries the same JSON-escaped quotes).
--
-- This migration redefines exactly those two functions, byte-for-byte from
-- their latest definitions (155 and 157), changing ONLY the hash expression.
-- create or replace preserves existing grants, so none are repeated here.

create or replace function public.respond_to_quote_proposal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text,
  p_selected_optional_line_ids uuid[] default '{}'::uuid[]
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
  target_client_email text;
  target_workspace_id uuid;
  target_workspace_status text;
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
  v_final_subtotal numeric(12,2);
  v_final_discount_amount numeric(12,2);
  v_final_tax_amount numeric(12,2);
  v_final_grand_total numeric(12,2);
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  if p_selected_optional_line_ids is not null and array_length(p_selected_optional_line_ids, 1) > 200 then
    raise exception 'Too many optional line selections.' using errcode = 'EC001';
  end if;

  select t.status, t.expires_at, p.id, p.content_snapshot, p.quote_id, p.client_email
  into token_status, token_expires_at, target_id, snapshot, target_quote_id, target_client_email
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal';

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  select q.workspace_id into target_workspace_id
  from public.sales_quotes q where q.id = target_quote_id;

  select w.status into target_workspace_status
  from public.workspaces w where w.id = target_workspace_id;

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
  if coalesce(target_workspace_status, 'active') <> 'active' then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  if snapshot ? 'grandTotal' then
    begin
      select coalesce(round(sum(
               round(((line->>'unitPrice')::numeric) * ((line->>'qty')::numeric), 2)
             ), 2), 0)
      into v_final_subtotal
      from jsonb_array_elements(snapshot->'bom') as line
      where coalesce((line->>'isOptional')::boolean, false) = false
         or (line->>'id') = any(p_selected_optional_line_ids::text[]);

      v_final_discount_amount := round(v_final_subtotal * coalesce((snapshot->>'discountPercent')::numeric, 0) / 100, 2);
      v_final_tax_amount := round((v_final_subtotal - v_final_discount_amount) * coalesce((snapshot->>'taxRate')::numeric, 0) / 100, 2);
      v_final_grand_total := round(v_final_subtotal - v_final_discount_amount + v_final_tax_amount, 2);
    exception when others then
      v_final_subtotal := null;
      v_final_discount_amount := null;
      v_final_tax_amount := null;
      v_final_grand_total := null;
    end;
  end if;

  update public.sales_quote_proposals as sqp
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_email = target_client_email,
      approval_content_hash = encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex'),
      selected_optional_line_ids = p_selected_optional_line_ids,
      final_subtotal = v_final_subtotal,
      final_discount_amount = v_final_discount_amount,
      final_tax_amount = v_final_tax_amount,
      final_grand_total = v_final_grand_total,
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

  begin
    update public.public_share_tokens
    set expires_at = now() + (
      select default_expiration_completed_documents from public.workspace_share_link_settings
      where workspace_id = target_workspace_id
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
  target_workspace_id uuid;
  target_workspace_status text;
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

  select p.workspace_id into target_workspace_id
  from public.projects p where p.id = target_project_id;

  select w.status into target_workspace_status
  from public.workspaces w where w.id = target_workspace_id;

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
  if coalesce(target_workspace_status, 'active') <> 'active' then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  update public.project_submittals as ps
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(convert_to(ps.content_snapshot::text, 'UTF8')), 'hex'),
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
      where workspace_id = target_workspace_id
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

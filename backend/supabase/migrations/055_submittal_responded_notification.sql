-- Fixes the gap flagged while building Quote Proposals: 'submittal_responded'
-- has been sitting in notification_rules as is_active=true since the very
-- first notification migration (024), but nothing has ever actually called
-- notify('submittal_responded', ...) anywhere -- so a client
-- approving/rejecting/requesting revision on a Submittal has never produced
-- a notification. Same fix as migration 054's quote_proposal_responded:
-- written directly into the security-definer RPC, since the client
-- responding has no authenticated app session to call the JS notify()
-- helper.
--
-- project_submittals has no "created by" column (Submittals are gated to
-- pm/admin writes, not tied to one individual), so there's no single owner
-- email to notify -- this notifies everyone holding the 'pm' role plus all
-- admins, reusing get_users_by_role (migration 042) and get_admin_emails
-- (migration 049) rather than inventing a new lookup.

create or replace function respond_to_submittal(share_token text, new_status text, approver_name text, approver_ip text, notes text)
returns void
language plpgsql
security definer
as $$
declare
  target_id uuid;
  target_project_id uuid;
  target_version integer;
  project_label text;
  rule_active boolean;
  recipient record;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid submittal response status';
  end if;

  select s.id, s.project_id, s.version into target_id, target_project_id, target_version
  from public_share_tokens t
  join project_submittals s on s.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'project_submittal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    raise exception 'Invalid or expired submittal link';
  end if;

  update project_submittals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(content_snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id;

  select p.project_name into project_label from projects p where p.id = target_project_id;

  select is_active into rule_active from notification_rules where event_type = 'submittal_responded';

  if coalesce(rule_active, false) then
    for recipient in
      select email from get_users_by_role('pm')
      union
      select email from get_admin_emails()
    loop
      insert into notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
      values (
        recipient.email,
        'submittal_responded',
        'Submittal ' || replace(new_status, '_', ' '),
        coalesce(project_label, 'A project') || ' submittal v' || target_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
        'project_submittal',
        target_id::text,
        'submittal_responded:' || target_id::text || ':' || new_status || ':' || recipient.email
      )
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;
end;
$$;

grant execute on function respond_to_submittal(text, text, text, text, text) to anon, authenticated;

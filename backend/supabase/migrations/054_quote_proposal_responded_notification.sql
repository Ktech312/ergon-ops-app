-- Notify the quote's owner when a client responds to a Quote Proposal.
--
-- This can't use the app's normal client-side notify() helper (main.tsx) --
-- that call requires an authenticated app session, and a client responding
-- to a public proposal link has none. So this writes the notification row
-- directly inside respond_to_quote_proposal itself (security definer,
-- already running with elevated privileges to update the proposal) rather
-- than depending on the browser to make a second, unauthenticated call.
--
-- Side note found while building this: project_submittals has the exact
-- same gap -- 'submittal_responded' has existed in notification_rules
-- since migration 024 with is_active=true, but nothing has ever actually
-- called notify('submittal_responded', ...) anywhere in the app, so client
-- responses to Submittals have never produced a notification. Worth a
-- follow-up fix, flagging rather than silently bundling it into this
-- unrelated migration.

-- Full accumulated list as of migration 049, plus quote_proposal_responded.
-- (An earlier version of this migration dropped the constraint back down
-- to migration 024's original 7 values, which would have violated the
-- check for any existing row using a value added by 046 or 049 -- fixed
-- before this migration was ever successfully applied.)
alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached',
    'catalog_price_change_requested', 'catalog_price_change_reviewed',
    'user_signup_pending', 'quote_proposal_responded'
  ));

insert into notification_rules (event_type, channels, is_active) values
  ('quote_proposal_responded', '{in_app}', true)
on conflict (event_type) do nothing;

create or replace function respond_to_quote_proposal(share_token text, new_status text, approver_name text, approver_ip text, notes text)
returns void
language plpgsql
security definer
as $$
declare
  target_id uuid;
  snapshot jsonb;
  target_quote_id uuid;
  target_version integer;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  select p.id, p.content_snapshot, p.quote_id, p.version
  into target_id, snapshot, target_quote_id, target_version
  from public_share_tokens t
  join sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    raise exception 'Invalid or expired proposal link';
  end if;

  update sales_quote_proposals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id;

  select q.created_by_email, q.site_name into owner_email, quote_site_name
  from sales_quotes q where q.id = target_quote_id;

  select is_active into rule_active from notification_rules where event_type = 'quote_proposal_responded';

  if owner_email is not null and coalesce(rule_active, false) then
    insert into notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
    values (
      owner_email,
      'quote_proposal_responded',
      'Proposal ' || replace(new_status, '_', ' '),
      coalesce(quote_site_name, 'A quote') || ' proposal v' || target_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
      'sales_quote_proposal',
      target_id::text,
      'quote_proposal_responded:' || target_id::text || ':' || new_status
    )
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

grant execute on function respond_to_quote_proposal(text, text, text, text, text) to anon, authenticated;

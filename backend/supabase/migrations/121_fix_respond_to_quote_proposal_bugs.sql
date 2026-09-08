-- Corrects two real bugs found live while E verified migration 119
-- (secure_quote_proposal_response), both fixed the same session by
-- applying ad-hoc CREATE OR REPLACE statements directly in Supabase
-- Studio -- this migration is the permanent, consolidated record of
-- exactly what ended up live, per the standing rule that an already-
-- applied migration's SQL is never edited retroactively (see 119's own
-- file, and migration 118's precedent for the same pattern after 117).
--
-- Bug 1 -- ambiguous column reference (Postgres 42702). Migration 119's
-- respond_to_quote_proposal() declares RETURNS TABLE (outcome, status,
-- responded_at, approval_name, version) -- in plpgsql, RETURNS TABLE
-- columns become implicit variables in scope for the entire function
-- body. Three of those names (status, responded_at, approval_name,
-- version) are ALSO real column names on sales_quote_proposals, so any
-- unqualified reference to them inside an embedded SQL statement is
-- genuinely ambiguous to Postgres -- this made the UPDATE ... WHERE
-- status = 'sent' ... RETURNING status, ... statement fail on every
-- real call, not just the test that first exposed it. Fixed by aliasing
-- the table (`as sqp`) and qualifying every reference in the UPDATE and
-- in the fallback re-select for the 'already_responded' branch.
--
-- Bug 2 -- ON CONFLICT arbiter mismatch (Postgres 42P10). The
-- notification insert's `on conflict (dedupe_key) do nothing` (copied
-- verbatim from the original migration 054, which has carried this same
-- bug since it shipped) does not match notifications' actual unique
-- index -- `create unique index idx_notifications_dedupe on
-- notifications(dedupe_key) where dedupe_key is not null` (migration
-- 024) is a PARTIAL unique index, and Postgres will not infer a partial
-- index as the ON CONFLICT arbiter unless the conflict clause restates
-- the matching WHERE predicate. Without it, every notification insert
-- attempt through this function has always failed with "no unique or
-- exclusion constraint matching the ON CONFLICT specification" --
-- meaning no real customer response to a proposal has ever successfully
-- notified the quote's owner. Fixed by adding `where dedupe_key is not
-- null` to the ON CONFLICT clause, matching the index exactly. This
-- migration does not touch the analogous, still-live bug in
-- respond_to_submittal() (migration 025/041 family) or any other
-- dedupe_key insert with the same unqualified pattern -- flagged here,
-- not silently fixed elsewhere, since fixing those is out of scope for
-- this security fix.
--
-- Same return signature as migration 119 -- CREATE OR REPLACE is
-- sufficient, no DROP needed.

begin;

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

  select p.id, p.content_snapshot, p.quote_id
  into target_id, snapshot, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
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

commit;

-- ============================================================
-- ALREADY RUN as of this file's creation (by E, directly in Supabase
-- Studio, as two ad-hoc corrective statements, both confirmed via the
-- transaction-safe test script in PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md
-- returning "ALL MIGRATION 119 TESTS PASSED" with no error). This file
-- exists so the repository's migration history matches what is actually
-- live -- running it again is a safe no-op (CREATE OR REPLACE with an
-- identical body).
-- ============================================================

-- Fixes a real, live vulnerability found during the 2026-09-08 overnight
-- security audit (PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md, Part A3):
-- respond_to_quote_proposal() has no server-side status-transition guard.
-- Anyone holding a proposal share token -- which never expires and cannot
-- be revoked (Parts A2/A4, deliberately NOT addressed by this migration,
-- see the note near the bottom of this file) -- can call the RPC directly
-- and repeatedly flip an already-approved/rejected/revision-requested
-- proposal, silently overwriting the previously recorded
-- responded_at/approval_name/approval_ip/response_notes/
-- approval_content_hash and (before this fix) creating a spurious second
-- notification for any status value not already used.
--
-- This migration claims the number "119" ahead of the Phase 2 plan's own
-- per-workspace uniqueness migration, per E's explicit instruction that
-- this security fix is prioritized first. That work is renumbered to
-- migration 120 -- see PRODUCT_PHASE2_PLAN.md, Revision 6. No content of
-- that plan changed, only its migration number.
--
-- Full design rationale, the concurrency-safety argument, and the
-- terminology mapping ("pending" in the fix requirements = this schema's
-- real status = 'sent') are written out in
-- PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md's "A3 resolution" section --
-- this file is the SQL alone, not a substitute for reading that.
--
-- Deliberately atomic, no explicit row lock needed: a plain conditional
-- `update ... where id = ... and status = 'sent'` is already safe against
-- two concurrent responses under Postgres's default READ COMMITTED
-- isolation -- the second of two racing UPDATE statements on the same row
-- must wait for the first's row lock to release, then re-evaluates its
-- WHERE clause against the just-committed row, matching zero rows if the
-- first transaction already changed the status. Standard, textbook-correct
-- pattern for this exact problem.
--
-- Before running this migration: run the preflight block in
-- PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md against production. Do not
-- run this migration until E has reviewed this file and the accompanying
-- preflight/verification/test/rollback blocks.

begin;

-- ============================================================
-- Section 1 -- get_quote_proposal_by_token(): unchanged query logic
-- (still checks t.expires_at exactly as before -- expiration behavior is
-- explicitly out of scope for this fix, see the note near the bottom of
-- this file), but now also returns responded_at/approval_name so the
-- public page can show "This proposal was approved on <date>" with real
-- data, and is hardened to the search_path='' + schema-qualified pattern
-- established in migration 115 (this function predates that discipline).
-- Grant narrowed to anon only -- confirmed by re-reading every call site
-- in persistence.ts (fetchPublicQuoteProposal/respondToPublicQuoteProposal)
-- that both always call with no access token, so every real call resolves
-- as anon; the authenticated grant this function had before was unused by
-- any code path found.
-- ============================================================

create or replace function public.get_quote_proposal_by_token(share_token text)
returns table (
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  responded_at timestamptz,
  approval_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  select p.id, p.status, p.version, p.content_snapshot, p.client_name, p.responded_at, p.approval_name
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
grant execute on function public.get_quote_proposal_by_token(text) to anon;

-- ============================================================
-- Section 2 -- respond_to_quote_proposal(): the real fix.
--
-- Returns a single row every well-formed call, distinguishing exactly
-- the outcomes the fix requirements ask for:
--   'invalid_token'     -- token doesn't resolve to a live, unexpired
--                           proposal. status/responded_at/approval_name/
--                           version all null.
--   'already_responded' -- the conditional UPDATE below matched zero
--                           rows because the proposal was no longer
--                           'sent' (a concurrency loser, or a stale
--                           resubmission of an already-answered link).
--                           The four state fields are populated from a
--                           FRESH re-select of the row after the failed
--                           UPDATE, not from this function's own earlier
--                           pre-UPDATE read -- the pre-UPDATE read can
--                           itself be stale relative to a concurrent
--                           winner's commit, so trusting it would risk
--                           reporting the wrong "already responded"
--                           state under real concurrency.
--   'success'            -- this call's UPDATE was the one that matched
--                           and changed the row. State fields come
--                           straight from the UPDATE ... RETURNING
--                           clause.
-- A genuine unexpected server failure (a real Postgres error) is
-- deliberately NOT folded into this three-way outcome -- it still
-- surfaces as a real thrown exception (PostgREST 500), giving the
-- frontend a clean two-tier distinction: any 200 response means "the RPC
-- ran to completion and is telling you what happened," any non-200 means
-- "something actually broke."
--
-- The notification-insert block only runs inside the 'success' branch,
-- after the conditional UPDATE has already confirmed this call is the
-- one that changed the row -- a concurrency loser or a stale
-- resubmission never reaches that code at all. The existing dedupe_key
-- is kept as a second, belt-and-suspenders layer, but the real fix is
-- structural: the losing branch can't reach the insert statement.
--
-- Hardened to security definer + search_path='' + fully schema-qualified
-- table references, matching migration 115's pattern (this function
-- predates that discipline). Grant narrowed to anon only, same reasoning
-- as Section 1.
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

  update public.sales_quote_proposals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id
    and status = 'sent'
  returning status, responded_at, approval_name, version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    -- Concurrency loser or stale resubmission. Re-read fresh -- do not
    -- trust the pre-UPDATE select above, which may be stale relative to
    -- a concurrent winner's commit.
    select status, responded_at, approval_name, version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.sales_quote_proposals
    where id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  -- Real, winning transition -- notify, exactly once.
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
    on conflict (dedupe_key) do nothing;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_quote_proposal(text, text, text, text, text) from public;
grant execute on function public.respond_to_quote_proposal(text, text, text, text, text) to anon;

commit;

-- ============================================================
-- Deliberately NOT done by this migration, per explicit instruction --
-- both remain open, tracked findings for a separate, explicitly-discussed
-- product decision:
--   - public_share_tokens.expires_at is still never set by any writer,
--     so proposal/submittal links still never actually expire in
--     practice (Part A2 of the security audit). No default expiration
--     period is introduced here.
--   - No token revocation mechanism is added (Part A4).
-- Both are recorded, unresolved findings -- not silently dropped.
-- ============================================================

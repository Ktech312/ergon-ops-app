-- Queue C2.6 follow-up (2026-09-13): wires the view-logging write path
-- Stage B of PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md always specified but
-- migration 139 didn't actually implement -- share_link_views (added,
-- inert, by migration 137) has never had anything insert into it.
-- Surfaced while reconciling that document against the now-shipped Queue
-- C2.6 internal Activity panel (src/main.tsx's ShareLinkLifecycleControls):
-- its view count reads this table and would silently show 0 forever
-- without this.
--
-- Redefines get_quote_proposal_by_token/get_submittal_by_token (both
-- already applied, via migration 139) to log exactly one view row per
-- call, mapped from the same internal token_status/expiry check these
-- functions already compute -- never a second, separate query. Same
-- external return shape, same outcome values, same authorization
-- (anon-only) -- this is additive logging only, not a behavior change to
-- what the client receives.
--
-- One outcome is deliberately NEVER logged: a genuinely unknown token
-- (outcome = 'invalid_token', the join to the proposal/submittal table
-- found nothing at all) has no entity_type/entity_id to attach a row to --
-- share_link_views.entity_type/entity_id are NOT NULL (migration 137), and
-- relaxing that to log truly-unknown tokens is a separate, larger schema
-- decision, not folded in here. Every other outcome (found/expired/
-- superseded/unavailable) DOES have a real entity_id available (the join
-- succeeded; only the token's own lifecycle state or expiration made it
-- non-`found`), so all four of those are logged, with `result` mapped to
-- share_link_views' own three-way disabled/revoked distinction (migration
-- 137) -- more detailed than the public `outcome` column's deliberately
-- collapsed `unavailable`, since this table is the internal audit trail
-- Part 8 item 4 says only authorized internal users ever see.
--
-- The insert is wrapped so a logging failure can never block a real
-- customer from reaching their document -- matching this schema's
-- existing best-effort posture for non-critical writes (e.g. migration
-- 139's own completed-document retention extension).
--
-- Confirm 143 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

create or replace function public.get_quote_proposal_by_token(share_token text)
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
  v_outcome text;
  v_view_result text;
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
    v_outcome := 'superseded';
    v_view_result := 'superseded';
  elsif v_token_status = 'temporarily_disabled' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  elsif v_token_status = 'permanently_revoked' then
    v_outcome := 'unavailable';
    v_view_result := 'revoked';
  elsif v_expires_at is not null and v_expires_at <= now() then
    v_outcome := 'expired';
    v_view_result := 'expired';
  else
    v_outcome := 'found';
    v_view_result := 'success';
  end if;

  begin
    insert into public.share_link_views (token, entity_type, entity_id, result)
    values (share_token, 'sales_quote_proposal', v_id, v_view_result);
  exception when others then
    null;
  end;

  if v_outcome <> 'found' then
    return query select v_outcome, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_responded_at, v_approval_name;
end;
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
revoke execute on function public.get_quote_proposal_by_token(text) from authenticated;
grant execute on function public.get_quote_proposal_by_token(text) to anon;

create or replace function public.get_submittal_by_token(share_token text)
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
  v_outcome text;
  v_view_result text;
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
    v_outcome := 'superseded';
    v_view_result := 'superseded';
  elsif v_token_status = 'temporarily_disabled' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  elsif v_token_status = 'permanently_revoked' then
    v_outcome := 'unavailable';
    v_view_result := 'revoked';
  elsif v_expires_at is not null and v_expires_at <= now() then
    v_outcome := 'expired';
    v_view_result := 'expired';
  else
    v_outcome := 'found';
    v_view_result := 'success';
  end if;

  begin
    insert into public.share_link_views (token, entity_type, entity_id, result)
    values (share_token, 'project_submittal', v_id, v_view_result);
  exception when others then
    null;
  end;

  if v_outcome <> 'found' then
    return query select v_outcome, null::uuid, null::text, null::integer, null::jsonb, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_project_name, v_responded_at, v_approval_name;
end;
$$;

revoke all on function public.get_submittal_by_token(text) from public;
revoke execute on function public.get_submittal_by_token(text) from authenticated;
grant execute on function public.get_submittal_by_token(text) to anon;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - A genuinely unknown token (outcome = invalid_token) is never logged
--     -- there is no entity_id to attach it to under the current NOT NULL
--     schema. Relaxing that is a separate, later decision, not assumed
--     here.
--   - respond_to_quote_proposal/respond_to_submittal are untouched -- the
--     decided audit scope for share_link_views is page-load views
--     specifically, not response submissions (those already have their
--     own outcome/status trail on the document row itself).
--   - No UI change -- Queue C2.6's Activity panel already reads this
--     table; it simply starts seeing real rows once this is live.
-- ============================================================

commit;

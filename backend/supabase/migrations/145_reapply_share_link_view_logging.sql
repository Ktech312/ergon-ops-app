-- Fixes a real, confirmed production defect: migration 143's own
-- write path was never actually live, despite being recorded as applied
-- (2026-09-14, "Success. No rows returned"). Root-caused through a
-- six-round diagnostic investigation (see HANDOFF.md's 2026-09-14 entries
-- for the full trail), each step sent to E as its own transaction-safe
-- read-only-in-effect script:
--   v1-v2: ruled out the diagnostic script's own bugs (an unregistered
--     foreign-key token, then a notice-delivery visibility problem).
--   v4-v5: ruled out RLS, table grants, and function/table ownership
--     entirely -- share_link_views and get_quote_proposal_by_token() share
--     the same owner (postgres), and a throwaway probe function with the
--     identical security-definer/search_path/insert shape succeeded
--     cleanly under the same role.
--   v6: dumped the LIVE deployed source of both functions verbatim via
--     pg_get_functiondef() and confirmed it definitively -- both functions
--     are running the exact migration-139 logic, with no v_view_result
--     variable and no insert into share_link_views anywhere in them. The
--     migration-143 logic was never actually live, for reasons this
--     investigation could not determine after the fact (a partial paste,
--     an out-of-order run, or something else -- the live database gives no
--     history of what happened, only what's currently deployed). This is
--     recorded as an open historical question, not assumed to be any one
--     specific cause.
--
-- Migration 143 itself is NOT edited or rerun -- per this repo's standing
-- rule, a correction to an already-applied migration is always a new,
-- sequentially-numbered migration, never a retroactive edit. This
-- migration re-applies the exact same intended function bodies migration
-- 143 always specified, verbatim, via CREATE OR REPLACE FUNCTION -- safe
-- and idempotent regardless of the functions' current state, so it
-- corrects the live database whether the original apply silently no-opped,
-- partially applied, or genuinely never ran. No design decision changes:
-- same signatures, same return shapes, same outcome values, same anon-only
-- authorization, same best-effort exception-swallowing posture around the
-- logging insert (a logging failure must never block a real customer from
-- reaching their document).
--
-- Confirm 145 is still the next free migration number at execution time.
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

commit;

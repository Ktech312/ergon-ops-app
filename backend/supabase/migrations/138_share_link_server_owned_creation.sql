-- Queue C2.3 (2026-09-13): server-owned share-link token creation.
-- Requires migration 137 to be live first (this migration reads/writes
-- columns/tables 137 adds). Replaces the two direct-INSERT client writers
-- (createSubmittalShareToken/createQuoteProposalShareToken,
-- src/persistence.ts) with hardened RPCs that derive everything
-- server-side -- never trust a caller-supplied workspace, status, actor,
-- or expiration. The frontend swap to call these RPCs instead of the
-- direct INSERT is a separate, later code-only change (not part of this
-- migration) -- until that lands, the OLD direct-INSERT path (still
-- permitted by public_share_tokens' existing wide-open policy) keeps
-- working exactly as today; closing that old path is Queue C2.7's job,
-- done only once the new RPCs are confirmed live.
--
-- Full design: PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md Part
-- 8 item 2 (ownership model) and Part 9.1 items 5-7 (this is where the
-- new columns/settings table from migration 137 are actually put to use
-- for the first time).
--
-- Confirm 138 is still the next free migration number at execution time,
-- and confirm migration 137 is live before running this one.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Token generation: two native gen_random_uuid() calls concatenated with
-- dashes stripped -- the exact same shape the client-side
-- generateShareToken() (src/persistence.ts) already produces via
-- crypto.randomUUID() x2, just moved server-side so it can never fall
-- back to the client's own weaker Math.random()-based path (which only
-- ever ran in an environment lacking the Web Crypto API -- rare, but a
-- real, avoidable weakness this closes outright). No pgcrypto dependency
-- -- gen_random_uuid() is native to Postgres 13+, already used
-- extensively throughout this schema.
-- ============================================================

create or replace function public.generate_share_token()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

revoke all on function public.generate_share_token() from public;
revoke execute on function public.generate_share_token() from anon;
grant execute on function public.generate_share_token() to authenticated;

-- ============================================================
-- create_submittal_share_token: authorization mirrors project_submittals'
-- own existing write policy (migration 025, "pm and admin write") --
-- creating a share link for a submittal is part of managing it, not a
-- separate authority concept. Submittal ownership handoff (Sales
-- pre-handoff, PM post-handoff) is Stage-2/out of scope for this queue;
-- today's PM/admin gate is preserved exactly as-is, not narrowed or
-- widened.
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

  v_workspace_id := public.active_workspace_id();
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

-- ============================================================
-- create_quote_proposal_share_token: authorization implements the
-- DECIDED ownership model (Part 8 item 2) -- "Proposals: owned end-to-end
-- by Sales... PM has no proposal authority at all. Managers and admins
-- may retain oversight/emergency access." This is narrower than
-- sales_quote_proposals' own current wide-open write policy (migration
-- 053, "authenticated write", any signed-in user) -- that policy is left
-- untouched by this migration (closing it is Queue C2.7's job, after the
-- frontend actually calls this RPC instead of writing directly); this new
-- RPC is simply the first place the decided ownership model is actually
-- enforced.
-- ============================================================

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

  v_workspace_id := public.active_workspace_id();
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
-- Deliberately NOT done by this migration:
--   - The frontend still calls the OLD direct-INSERT path
--     (createSubmittalShareToken/createQuoteProposalShareToken) -- these
--     new RPCs exist and are ready, but nothing calls them yet. Wiring
--     the frontend to call rpc/create_submittal_share_token and
--     rpc/create_quote_proposal_share_token instead is a separate,
--     code-only change, reviewed and shipped alongside (not before)
--     Queue C2.7's direct-write closure -- switching the writer without
--     closing the old path would leave two ways to create a token,
--     one hardened and one not.
--   - No expiration value is applied to any EXISTING token -- this
--     migration only ever sets expires_at on a token IT creates, going
--     forward. Retroactively applying a default to old tokens (making a
--     link that never expired suddenly start expiring) is exactly the
--     kind of destructive rewrite the task's own instruction prohibits.
--   - Completed-document long-retention (the 2-year default) is not
--     applied here at all -- a token is only ever created while its
--     document is being sent, not yet completed. Extending expires_at to
--     the completed-document default happens at RESPONSE time, in Queue
--     C2.4's migration, the point where "this document just became
--     completed" is actually known.
-- ============================================================

commit;

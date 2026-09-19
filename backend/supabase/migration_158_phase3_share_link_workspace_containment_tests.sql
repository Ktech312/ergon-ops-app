-- Transaction-safe canonical test for migration 158 (Phase 3
-- cross-cutting: share-link RPC family workspace containment).
-- Wrapped in begin;/rollback; -- nothing here ever commits. Synthetic
-- second workspace created only inside this rolled-back transaction,
-- mirroring migrations 155/156/157's own established fixture strategy.
--
-- No entity-sibling-supersession landmine here, unlike
-- create_and_send_submittal_version/create_and_send_quote_proposal_
-- version (migrations 155/157's own test fixture-ordering lesson):
-- every function tested below (disable/re_enable/permanently_revoke/
-- regenerate_share_link, create_submittal_share_token,
-- create_quote_proposal_share_token) only ever touches the ONE token
-- or entity it is given -- none of them loop over and mutate sibling
-- tokens for the same parent entity, so fixtures created early in this
-- script are never silently invalidated by a later section the way
-- token_a was in migration 157's first live run.
--
-- Coverage strategy: correct-workspace-allowed and another-workspace-
-- denied are run BEHAVIORALLY against create_submittal_share_token,
-- create_quote_proposal_share_token, disable_share_link, and
-- regenerate_share_link. re_enable_share_link, permanently_revoke_
-- share_link, and create_and_send_quote_proposal_version are verified
-- STRUCTURALLY (source inspection via pg_get_functiondef, and grants
-- via has_function_privilege) -- same technique migration 155's own
-- Section 8/11 and migration_124's test use for their own
-- hard-to-behaviorally-duplicate cases, since re_enable/permanently_
-- revoke share identical logic shape to disable_share_link (already
-- proven behaviorally) and create_and_send_quote_proposal_version's
-- own containment is already proven end-to-end by migration 155's own
-- Section 7 test of its wrapper, request_or_send_quote_proposal_version.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 158 PHASE 3 SHARE LINK
-- WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  ws_b uuid;

  project_a_id uuid;
  submittal_a_id uuid;
  quote_a_id uuid;
  proposal_a_id uuid;
  disable_token text := 'ZZ_TEST_158_DISABLE_' || gen_random_uuid()::text;
  regen_token text := 'ZZ_TEST_158_REGEN_' || gen_random_uuid()::text;

  caught boolean;
  caught_message text;
  new_token text;
  outcome_text text;
  fn_def text;
  can_authenticated boolean;
  row_count integer;
begin
  -- ============================================================
  -- Section 0: fixture discovery, synthetic workspace, synthetic
  -- Project/Submittal + Quote/Proposal fixtures, and two pre-existing
  -- share tokens for the disable/regenerate tests.
  -- ============================================================

  -- CONSOLIDATED-SUITE FINDING (found running the full 001-185 replay):
  -- same fixture-discovery ambiguity documented in migration 156's own
  -- test -- this file needs a caller who can actually write a `projects`
  -- row (admin or 'pm'-gated since migration 157), and with more than one
  -- real workspace member present an unordered `limit 1` can pick a
  -- member who is neither. Made deterministic the same way.
  select wm.user_id, wm.workspace_id into real_user_id, real_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  order by wm.is_workspace_admin desc
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing active workspace member found -- this script requires at least one real user already in workspace_members.';
  end if;

  insert into public.workspaces (id, name, slug, status)
  values (gen_random_uuid(), 'ZZ_TEST_158 Other Workspace', 'zz-test-158-other-' || substr(gen_random_uuid()::text, 1, 8), 'active')
  returning id into ws_b;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_158 Project A') returning id into project_a_id;
  insert into public.sales_quotes (site_name, client_name, status)
    values ('ZZ_TEST_158 Quote A', 'ZZ_TEST_158 Client A', 'open') returning id into quote_a_id;

  perform set_config('role', 'postgres', true);

  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email, sent_at)
    values (project_a_id, 1, 'sent', '{}'::jsonb, 'ZZ_TEST_158 Client A', 'zz-test-158-client@example.invalid', now())
    returning id into submittal_a_id;
  insert into public.sales_quote_proposals (quote_id, status, version, content_snapshot, client_name, client_email)
    values (quote_a_id, 'sent', 1, '{}'::jsonb, 'ZZ_TEST_158 Client A', 'zz-test-158-client@example.invalid')
    returning id into proposal_a_id;

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
    values (disable_token, 'project_submittal', submittal_a_id, now() + interval '30 days');
  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
    values (regen_token, 'sales_quote_proposal', proposal_a_id, now() + interval '30 days');

  raise notice 'TEST SETUP: real_user_id=%, real_workspace_id=%, ws_b=%', real_user_id, real_workspace_id, ws_b;

  -- ============================================================
  -- Section 1: create_submittal_share_token -- correct workspace
  -- allowed, another workspace denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.create_submittal_share_token(submittal_a_id) into new_token;
  if new_token is null then
    raise exception 'TEST FAILED: correct-workspace create_submittal_share_token call did not return a token';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    caught_message := null;
    perform public.create_submittal_share_token(submittal_a_id);
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('does not belong to your workspace' in caught_message) = 0 then
    raise exception 'TEST FAILED: create_submittal_share_token did not reject a ws_b-only caller acting on a ws_real submittal (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  raise notice 'TEST PASSED: Section 1 -- create_submittal_share_token allows the correct workspace and rejects another workspace';

  -- ============================================================
  -- Section 2: create_quote_proposal_share_token -- correct workspace
  -- allowed, another workspace denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.create_quote_proposal_share_token(proposal_a_id) into new_token;
  if new_token is null then
    raise exception 'TEST FAILED: correct-workspace create_quote_proposal_share_token call did not return a token';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    caught_message := null;
    perform public.create_quote_proposal_share_token(proposal_a_id);
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('does not belong to your workspace' in caught_message) = 0 then
    raise exception 'TEST FAILED: create_quote_proposal_share_token did not reject a ws_b-only caller acting on a ws_real proposal (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  raise notice 'TEST PASSED: Section 2 -- create_quote_proposal_share_token allows the correct workspace and rejects another workspace';

  -- ============================================================
  -- Section 3: disable_share_link -- correct workspace allowed, another
  -- workspace denied. Uses disable_token (submittal-side), created
  -- directly in Section 0.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    caught_message := null;
    perform public.disable_share_link(disable_token, 'zz-test-158 cross-workspace attempt');
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('does not belong to your workspace' in caught_message) = 0 then
    raise exception 'TEST FAILED: disable_share_link did not reject a ws_b-only caller acting on a ws_real token (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.disable_share_link(disable_token, 'zz-test-158 correct-workspace disable') into outcome_text;
  if outcome_text <> 'success' then
    raise exception 'TEST FAILED: correct-workspace disable_share_link call did not succeed (got %)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 3 -- disable_share_link allows the correct workspace and rejects another workspace';

  -- ============================================================
  -- Section 4: regenerate_share_link -- correct workspace allowed,
  -- another workspace denied. Uses regen_token (proposal-side).
  -- ============================================================

  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    caught_message := null;
    perform public.regenerate_share_link(regen_token);
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('does not belong to your workspace' in caught_message) = 0 then
    raise exception 'TEST FAILED: regenerate_share_link did not reject a ws_b-only caller acting on a ws_real token (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.regenerate_share_link(regen_token) into new_token;
  if new_token is null then
    raise exception 'TEST FAILED: correct-workspace regenerate_share_link call did not return a new token';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 4 -- regenerate_share_link allows the correct workspace and rejects another workspace';

  -- ============================================================
  -- Section 5: structural verification for re_enable_share_link,
  -- permanently_revoke_share_link, and create_and_send_quote_proposal_
  -- version -- confirms the containment call (or, for the last one, the
  -- fully-closed grant) via source inspection.
  -- ============================================================

  select pg_get_functiondef('public.re_enable_share_link(text)'::regprocedure) into fn_def;
  if position('assert_share_link_in_caller_workspace' in fn_def) = 0 then
    raise exception 'TEST FAILED: re_enable_share_link no longer calls assert_share_link_in_caller_workspace';
  end if;

  select pg_get_functiondef('public.permanently_revoke_share_link(text, text)'::regprocedure) into fn_def;
  if position('assert_share_link_in_caller_workspace' in fn_def) = 0 then
    raise exception 'TEST FAILED: permanently_revoke_share_link no longer calls assert_share_link_in_caller_workspace';
  end if;

  select has_function_privilege('authenticated', 'public.create_and_send_quote_proposal_version(uuid, jsonb, text, text)', 'execute') into can_authenticated;
  if can_authenticated then
    raise exception 'TEST FAILED: create_and_send_quote_proposal_version is directly callable by authenticated -- should remain reachable only through request_or_send_quote_proposal_version()';
  end if;

  select pg_get_functiondef('public.create_and_send_quote_proposal_version(uuid, jsonb, text, text)'::regprocedure) into fn_def;
  if position('active_workspace_id' in fn_def) > 0 then
    raise exception 'TEST FAILED: create_and_send_quote_proposal_version still calls active_workspace_id() -- should use the quote''s own resolved workspace_id instead';
  end if;

  raise notice 'TEST PASSED: Section 5 -- re_enable_share_link/permanently_revoke_share_link confirmed to call the new containment check; create_and_send_quote_proposal_version confirmed not directly callable and no longer using active_workspace_id()';

  -- ============================================================
  -- Section 6: confirm active_workspace_id() is gone from every other
  -- function this migration touched.
  -- ============================================================

  select pg_get_functiondef('public.create_submittal_share_token(uuid)'::regprocedure) into fn_def;
  if position('active_workspace_id' in fn_def) > 0 then
    raise exception 'TEST FAILED: create_submittal_share_token still calls active_workspace_id()';
  end if;

  select pg_get_functiondef('public.create_quote_proposal_share_token(uuid)'::regprocedure) into fn_def;
  if position('active_workspace_id' in fn_def) > 0 then
    raise exception 'TEST FAILED: create_quote_proposal_share_token still calls active_workspace_id()';
  end if;

  select pg_get_functiondef('public.regenerate_share_link(text)'::regprocedure) into fn_def;
  if position('active_workspace_id' in fn_def) > 0 then
    raise exception 'TEST FAILED: regenerate_share_link still calls active_workspace_id()';
  end if;

  raise notice 'TEST PASSED: Section 6 -- active_workspace_id() confirmed retired from every function this migration touched';

  raise notice 'ALL MIGRATION 158 PHASE 3 SHARE LINK WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

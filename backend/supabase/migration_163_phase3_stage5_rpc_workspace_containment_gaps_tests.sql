-- Transaction-safe canonical test for migration 163 (Phase 3, Stage 5,
-- first RPC-hardening pass: replace_project_bom_lines(),
-- respond_to_proposal_question(), submit_proposal_question()). Wrapped
-- in begin;/rollback; -- nothing here ever commits. Any synthetic
-- second workspace this script creates lives ONLY inside this
-- rolled-back transaction, never a persistent second workspace.
--
-- Each of the three functions gets one baseline (correct-workspace,
-- must still succeed exactly as before) and one cross-workspace/
-- suspended-workspace behavioral check (the real fix this migration
-- exists for) -- this migration is entirely behavioral fixes to three
-- specific RPCs, not a table/RLS migration, so there is no structural
-- sweep section.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 163 PHASE 3 STAGE 5 RPC
-- WORKSPACE CONTAINMENT GAPS TESTS PASSED -- ZERO SECTIONS SKIPPED", or
-- a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  row_count integer;
  caught boolean;
  error_text text;
  project_a_id uuid;
  project_b_id uuid;
  item_a_id uuid;
  item_b_id uuid;
  quote_a_id uuid;
  proposal_a_id uuid;
  question_a_id uuid;
  token_a text := 'ZZ_TEST_163_TOKEN_' || gen_random_uuid()::text;
  quote_b_id uuid;
  proposal_b_id uuid;
  question_b_id uuid;
  result_json jsonb;
  outcome_val text;
  answered_at_val timestamptz;
  question_id_val uuid;
  asked_at_val timestamptz;
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member.
  -- ============================================================

  select am.user_id, wm.workspace_id, wm.is_workspace_admin
    into real_user_id, real_workspace_id, real_member_was_admin
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: replace_project_bom_lines() -- baseline success, then
  -- cross-workspace project_id and cross-workspace inventory_item both
  -- rejected.
  -- ============================================================

  insert into public.projects (project_name) values ('ZZ_TEST_163 Project A') returning id into project_a_id;
  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-163-A', 'ZZ_TEST_163 Item A') returning id into item_a_id;

  select public.replace_project_bom_lines(
    project_a_id,
    jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_163 Item A', 'sku', 'ZZ-SKU-163-A', 'qty', 3, 'status', 'Not started', 'request_speed', 'Standard'))
  ) into result_json;
  if (result_json->>'insertedCount')::int <> 1 then
    raise exception 'TEST FAILED: replace_project_bom_lines baseline call did not insert the expected line for a real-workspace project';
  end if;

  -- Build workspace B's own project and inventory item (admin
  -- temporarily moved into ws_b, exactly the technique proven in every
  -- prior Phase 3 test).
  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_163 Other Workspace', 'zz-test-163-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ_TEST_163 Project B') returning id into project_b_id;
  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-163-B', 'ZZ_TEST_163 Item B') returning id into item_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Cross-workspace project_id: must reject with EC002, not silently
  -- replace another workspace's BOM.
  caught := false;
  begin
    perform public.replace_project_bom_lines(project_b_id, jsonb_build_array());
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then raise exception 'TEST FAILED: replace_project_bom_lines() accepted a project_id belonging to another workspace'; end if;
  if position('does not belong to your workspace' in error_text) = 0 then
    raise exception 'TEST FAILED: cross-workspace project_id was rejected for the wrong reason: %', error_text;
  end if;

  -- Cross-workspace inventory_item reference (own project, sku from
  -- workspace B): must be treated as unresolved, not silently linked.
  caught := false;
  begin
    perform public.replace_project_bom_lines(
      project_a_id,
      jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_163 Item B', 'sku', 'ZZ-SKU-163-B', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'))
    );
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then raise exception 'TEST FAILED: replace_project_bom_lines() resolved a sku belonging to another workspace''s inventory_items row'; end if;
  if position('could not be found' in error_text) = 0 then
    raise exception 'TEST FAILED: cross-workspace sku was rejected for the wrong reason: %', error_text;
  end if;

  raise notice 'TEST PASSED: Section 1 -- replace_project_bom_lines() correctly contains both project_id and inventory_items resolution to the caller''s own workspace';

  -- ============================================================
  -- Section 2: respond_to_proposal_question() -- baseline success, then
  -- a cross-workspace question_id is reported as not_found.
  -- ============================================================

  -- sales_quote_proposals/sales_quote_proposal_questions are RPC-write-
  -- only (no direct INSERT policy/grant for 'authenticated') -- fixture
  -- rows are created under the postgres role, same as migration 155's
  -- own test does for this exact table.
  perform set_config('role', 'postgres', true);
  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_163 Site A', 'ZZ_TEST_163 Client A', 'draft') returning id into quote_a_id;
  insert into public.sales_quote_proposals (quote_id, status) values (quote_a_id, 'sent') returning id into proposal_a_id;
  insert into public.sales_quote_proposal_questions (proposal_id, question_text) values (proposal_a_id, 'ZZ_TEST_163 question A') returning id into question_a_id;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, answered_at into outcome_val, answered_at_val
  from public.respond_to_proposal_question(question_a_id, 'ZZ_TEST_163 answer A');
  if outcome_val <> 'answered' or answered_at_val is null then
    raise exception 'TEST FAILED: respond_to_proposal_question baseline call did not succeed for a real-workspace question (outcome=%)', outcome_val;
  end if;

  -- Workspace B's own quote/proposal/question, built the same
  -- admin-relocation way as Section 1.
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_163 Site B', 'ZZ_TEST_163 Client B', 'draft') returning id into quote_b_id;

  perform set_config('role', 'postgres', true);
  insert into public.sales_quote_proposals (quote_id, status) values (quote_b_id, 'sent') returning id into proposal_b_id;
  insert into public.sales_quote_proposal_questions (proposal_id, question_text) values (proposal_b_id, 'ZZ_TEST_163 question B') returning id into question_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, answered_at into outcome_val, answered_at_val
  from public.respond_to_proposal_question(question_b_id, 'ZZ_TEST_163 hijack attempt');
  if outcome_val <> 'not_found' then
    raise exception 'TEST FAILED: respond_to_proposal_question() did not treat a cross-workspace question as not_found (got %)', outcome_val;
  end if;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.sales_quote_proposal_questions where id = question_b_id and status = 'open';
  if row_count <> 1 then raise exception 'TEST FAILED: a cross-workspace question was actually answered despite the not_found outcome'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- respond_to_proposal_question() correctly reports a cross-workspace question as not_found and leaves it untouched';

  -- ============================================================
  -- Section 3: submit_proposal_question() -- baseline success (anon,
  -- via token), then a suspended workspace reports unavailable. Fixture
  -- created BEFORE suspension, per the established lesson from migration
  -- 155's own Section 5 (guard_workspace_id_mutation blocks all writes,
  -- including INSERT, for a suspended-workspace caller).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.public_share_tokens (token, entity_type, entity_id) values (token_a, 'sales_quote_proposal', proposal_a_id);

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  select outcome, question_id, asked_at into outcome_val, question_id_val, asked_at_val
  from public.submit_proposal_question(token_a, 'ZZ_TEST_163 client question', 'ZZ_TEST_163 Asker');
  if outcome_val <> 'submitted' or question_id_val is null then
    raise exception 'TEST FAILED: submit_proposal_question baseline call did not succeed for a real, active-workspace token (outcome=%)', outcome_val;
  end if;

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = real_workspace_id;

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);
  select outcome, question_id, asked_at into outcome_val, question_id_val, asked_at_val
  from public.submit_proposal_question(token_a, 'ZZ_TEST_163 question while suspended', 'ZZ_TEST_163 Asker');
  if outcome_val <> 'unavailable' then
    raise exception 'TEST FAILED: submit_proposal_question() did not treat a suspended workspace as unavailable (got %)', outcome_val;
  end if;

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'active' where id = real_workspace_id;

  raise notice 'TEST PASSED: Section 3 -- submit_proposal_question() correctly reports a suspended workspace as unavailable';

  raise notice 'ALL MIGRATION 163 PHASE 3 STAGE 5 RPC WORKSPACE CONTAINMENT GAPS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

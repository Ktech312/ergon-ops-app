-- Transaction-safe canonical test for migration 166 (Phase 3, Stage 5,
-- third migration: deletion_log workspace containment). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace this script creates lives ONLY inside this rolled-back
-- transaction, never a persistent second workspace.
--
-- Does not exhaustively exercise all 21 entity_type dispatch branches
-- (that would mean fabricating fixtures across nearly every table in
-- the app) -- instead exercises one representative case of each of the
-- resolution shapes migration 166 introduced (direct column, one-hop,
-- two-hop), plus the two behaviors that are the actual point of this
-- migration's design: a known residual-gap entity type logs with
-- workspace_id null BY DESIGN (not a bug to "fix" in this test), and an
-- unrecognized entity_type is rejected outright (fail closed). The
-- SELECT policy itself is checked against both a real scoped row and a
-- real null (global) row.
--
-- Section 4 originally exercised migration 166's fourth resolution
-- shape, "genuinely-global" (schedule_template_phase, workspace_id
-- always null). Migration 173 later gave that entity type a real
-- workspace_id and a one-hop lookup, so it is no longer an example of
-- that shape -- Section 4 now exercises it as a second one-hop case and
-- confirms the cross-workspace leak migration 173 closed stays closed.
-- See Section 4's own header comment for the full history.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 166 DELETION LOG
-- WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  error_text text;
  quote_a_id uuid;
  project_a_id uuid;
  quote_loc_a_id uuid;
  quote_loc_item_a_id uuid;
  phase_id uuid;
  template_id uuid;
  item_id uuid;
  log_row_id uuid;
  seen_workspace_id uuid;
  visible_count int;
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member, then build a synthetic second workspace the same way every
  -- prior Phase 3 test has.
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

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_166 Other Workspace', 'zz-test-166-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: direct-column resolution (sales_quote) -- log a real
  -- deletion, confirm workspace_id derived correctly, and confirm a
  -- cross-workspace caller cannot see it.
  -- ============================================================

  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_166 Site A', 'ZZ_TEST_166 Client A', 'open') returning id into quote_a_id;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('sales_quote', quote_a_id, 'ZZ_TEST_166 Site A', 'deleted', 'zz-test-166@example.com')
    returning id, workspace_id into log_row_id, seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: deletion_log did not derive the correct workspace_id for a direct-column entity_type (sales_quote): got %, expected %', seen_workspace_id, real_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.deletion_log where id = log_row_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: a workspace-B caller could see workspace A''s sales_quote deletion_log row';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 1 -- direct-column entity_type (sales_quote) is derived and scoped correctly';

  -- ============================================================
  -- Section 2: one-hop resolution (project_location -> projects).
  -- ============================================================

  insert into public.projects (project_name) values ('ZZ_TEST_166 Project A') returning id into project_a_id;
  insert into public.project_locations (project_id, location_type) values (project_a_id, 'garage') returning id into quote_loc_a_id;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('project_location', quote_loc_a_id, 'ZZ_TEST_166 Location A', 'deleted', 'zz-test-166@example.com')
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: deletion_log did not derive the correct workspace_id for a one-hop entity_type (project_location): got %, expected %', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 2 -- one-hop entity_type (project_location) is derived correctly';

  -- ============================================================
  -- Section 3: two-hop resolution (sales_quote_location_item ->
  -- sales_quote_locations -> sales_quotes).
  -- ============================================================

  insert into public.sales_quote_locations (quote_id, location_type) values (quote_a_id, 'garage') returning id into quote_loc_a_id;
  insert into public.sales_quote_location_items (quote_location_id, line_type) values (quote_loc_a_id, 'camera') returning id into quote_loc_item_a_id;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('sales_quote_location_item', quote_loc_item_a_id, 'ZZ_TEST_166 Item A', 'deleted', 'zz-test-166@example.com')
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: deletion_log did not derive the correct workspace_id for a two-hop entity_type (sales_quote_location_item): got %, expected %', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 3 -- two-hop entity_type (sales_quote_location_item) is derived correctly';

  -- ============================================================
  -- Section 4: schedule_template_phase -- at the time migration 166 was
  -- written this was one of four entity types with "no workspace
  -- concept", so this section originally asserted a NULL, globally-
  -- visible workspace_id here. Migration 173 (Section 6 of that file)
  -- gave project_schedule_template_phases a real workspace_id column and
  -- replaced this exact CASE branch in derive_deletion_log_workspace_id()
  -- with a real one-hop lookup (`select workspace_id from
  -- project_schedule_template_phases where id = new.entity_id`), carried
  -- forward unchanged by migration 177. This entity type has NOT been
  -- genuinely global since 173 landed. The consolidated isolation suite's
  -- first full run (see HANDOFF.md) caught this file still asserting the
  -- pre-173 behavior against the post-173 schema and mis-flagged it as a
  -- live production bug; direct verification against production's actual
  -- function body proved production already has 173/177's fix, so the
  -- bug was in this assertion, not in production. Updated below to match
  -- the current, correct, already-applied behavior: a real derived
  -- workspace_id, and NO cross-workspace visibility (the very leak
  -- migration 173 closed). Migration 166 itself is not edited or rerun.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.project_schedule_templates (name) values ('ZZ_TEST_166 Template A') returning id into template_id;
  insert into public.project_schedule_template_phases (template_id, phase_name, sequence_order) values (template_id, 'ZZ_TEST_166 Phase A', 1) returning id into phase_id;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('schedule_template_phase', phase_id, 'ZZ_TEST_166 Phase A', 'deleted', 'zz-test-166@example.com')
    returning id, workspace_id into log_row_id, seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: deletion_log did not derive the correct workspace_id for schedule_template_phase (workspace-scoped since migration 173): got %, expected %', seen_workspace_id, real_workspace_id;
  end if;

  select count(*) into visible_count from public.deletion_log where id = log_row_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace A caller could not see its own schedule_template_phase deletion_log row';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.deletion_log where id = log_row_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: a workspace-B caller could see workspace A''s schedule_template_phase deletion_log row -- this entity type has been workspace-scoped since migration 173 and must not leak cross-workspace';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 4 -- schedule_template_phase (workspace-scoped since migration 173) derives the real workspace_id and is no longer visible cross-workspace';

  -- ============================================================
  -- Section 5: known residual-gap entity_type (inventory_item) -- must
  -- derive NULL by design (the source row is already hard-deleted by
  -- the time this insert would run in real usage; here the inventory
  -- item row is left in place rather than actually deleted, since the
  -- point is confirming the DISPATCH case itself resolves to null, not
  -- that a lookup fails to find a row for an unrelated reason).
  -- ============================================================

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-166-A', 'ZZ_TEST_166 Item A') returning id into item_id;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('inventory_item', item_id, 'ZZ_TEST_166 Item A', 'deleted', 'zz-test-166@example.com')
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is not null then
    raise exception 'TEST FAILED: inventory_item is a documented residual gap and must derive NULL (this migration does not close it) -- got %', seen_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 5 -- known residual-gap entity_type (inventory_item) derives NULL exactly as documented, not silently "fixed" by accident';

  -- ============================================================
  -- Section 6: an unrecognized entity_type must be rejected outright
  -- (fail closed), never silently logged as unscoped.
  -- ============================================================

  caught := false;
  error_text := null;
  begin
    insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
      values ('zz_test_166_unknown_entity_type', gen_random_uuid(), 'should never insert', 'deleted', 'zz-test-166@example.com');
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then raise exception 'TEST FAILED: an unrecognized entity_type was silently accepted instead of being rejected'; end if;
  if position('unrecognized entity_type' in coalesce(error_text, '')) = 0 then
    raise exception 'TEST FAILED: unrecognized entity_type was rejected for the wrong reason: %', error_text;
  end if;

  raise notice 'TEST PASSED: Section 6 -- an unrecognized entity_type is rejected outright (fail closed)';

  raise notice 'ALL MIGRATION 166 DELETION LOG WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

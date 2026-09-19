-- Transaction-safe tests for migration 136's Sales pricing foundations.
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users for every authorization check (never fabricates
-- a fake auth.users row), same discipline as
-- migration_134_client_id_carry_through_tests.sql. Every Sales Quote,
-- client, and proposal this script creates is synthetic, fresh inside this
-- same rolled-back transaction, clearly named "ZZ_TEST_...".
--
-- This script does NOT re-run the full create_project_from_quote
-- authorization matrix (already exhaustively covered by
-- migration_127_conversion_tests.sql and migration_134's own tests,
-- unaffected by this migration) -- it re-checks exactly one denial case as
-- a regression guard and otherwise focuses on what migration 136 alone
-- changes: pricing columns/constraints, the backfill, and the accepted-
-- proposal-total carry-through.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 136 SALES PRICING TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming what failed
-- or was skipped.

begin;

do $$
declare
  admin_user_id uuid;
  pm_user_id uuid;
  pm_role_preexisted boolean;
  quote_creator_user_id uuid;
  quote_creator_workspace_id uuid;
  non_privileged_user_id uuid;
  original_role text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  v_client_id uuid;
  test_bom_line_id uuid;
  legacy_default_line_id uuid;
  test_quote_id uuid;
  test_quote_no_proposal_id uuid;
  test_quote_old_snapshot_id uuid;
  test_quote_denial_id uuid;
  site_name text;
  site_name_no_proposal text;
  site_name_old_snapshot text;
  site_name_denial text;

  result_json jsonb;
  result_json_retry jsonb;
  project_id uuid;
  project_id_no_proposal uuid;
  project_id_old_snapshot uuid;
  project_accepted_total numeric;
  caught boolean;

  legacy_row_count integer;
  legacy_unverified_count integer;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  spoofed_user_id uuid;
begin
  select current_setting('role') into original_role;

  select user_id into admin_user_id from public.app_admins limit 1;
  select wm.user_id, wm.workspace_id into quote_creator_user_id, quote_creator_workspace_id
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where w.status = 'active'
    limit 1;

  if admin_user_id is null or quote_creator_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user or no active-workspace member found)');
  else
    select wm.user_id into pm_user_id
      from public.workspace_members wm
      join public.workspace_member_roles wmr on wmr.workspace_member_id = wm.id
      where wm.workspace_id = quote_creator_workspace_id
        and wmr.role_key = 'pm'
        and wm.user_id not in (select user_id from public.app_admins)
      limit 1;
    pm_role_preexisted := pm_user_id is not null;
    if pm_user_id is null then
      select wm.user_id into pm_user_id
        from public.workspace_members wm
        where wm.workspace_id = quote_creator_workspace_id
          and wm.user_id not in (select user_id from public.app_admins)
        limit 1;
      if pm_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'pm', false)
          on conflict do nothing;
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select wm.id, 'pm', false from public.workspace_members wm
          where wm.workspace_id = quote_creator_workspace_id and wm.user_id = pm_user_id
          on conflict do nothing;
      end if;
    end if;

    select wm.user_id into non_privileged_user_id
      from public.workspace_members wm
      where wm.workspace_id = quote_creator_workspace_id
        and wm.user_id not in (select user_id from public.app_admins)
        and wm.user_id not in (
          select wm2.user_id from public.workspace_members wm2
          join public.workspace_member_roles wmr2 on wmr2.workspace_member_id = wm2.id
          where wm2.workspace_id = quote_creator_workspace_id and wmr2.role_key = 'pm'
        )
        and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      limit 1;

    perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    insert into public.clients (name) values ('ZZ_TEST_CLIENT_' || substr(md5(random()::text), 1, 10))
      returning id into v_client_id;

    -- Section 1: constraint checks -- each of these must be REJECTED.
    -- A throwaway quote to hang the constraint-check BOM line off of.
    site_name := 'ZZ_TEST_PRICING_CONSTRAINTS_' || substr(md5(random()::text), 1, 10);
    insert into public.sales_quotes (client_name, site_name, status, client_id)
      values ('ZZ Test Client', site_name, 'open', v_client_id)
      returning id into test_quote_id;

    caught := false;
    begin
      insert into public.sales_quote_bom_lines (quote_id, item_name, qty, unit_price)
        values (test_quote_id, 'ZZ_TEST_NEGATIVE_PRICE', 1, -5);
    exception when check_violation then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: a negative unit_price was accepted -- the check constraint is missing or broken.';
    end if;

    caught := false;
    begin
      insert into public.sales_quote_bom_lines (quote_id, item_name, qty, unit_price)
        values (test_quote_id, 'ZZ_TEST_NAN_PRICE', 1, 'NaN'::numeric);
    exception when check_violation then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: unit_price = NaN was accepted -- the finite-money constraint is missing or broken.';
    end if;

    caught := false;
    begin
      insert into public.sales_quote_bom_lines (quote_id, item_name, qty, unit_price, price_source)
        values (test_quote_id, 'ZZ_TEST_BAD_SOURCE', 1, 10, 'made_up_source');
    exception when others then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: an invalid price_source value was accepted -- the check constraint is missing or broken.';
    end if;

    caught := false;
    begin
      update public.sales_quotes set discount_percent = 150 where id = test_quote_id;
    exception when check_violation then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: discount_percent = 150 was accepted -- the 0-100 check constraint is missing or broken.';
    end if;

    caught := false;
    begin
      update public.sales_quotes set tax_rate = -1 where id = test_quote_id;
    exception when check_violation then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: a negative tax_rate was accepted -- the check constraint is missing or broken.';
    end if;

    -- Section 2: catalog_default / manual_override are valid, and Postgres
    -- replaces browser-supplied audit attribution with the authenticated
    -- caller and database time.
    insert into public.sales_quote_bom_lines (quote_id, item_name, qty, unit_price, price_source)
      values (test_quote_id, 'ZZ_TEST_CATALOG_DEFAULT_LINE', 2, 100.00, 'catalog_default')
      returning id into test_bom_line_id;
    spoofed_user_id := gen_random_uuid();
    update public.sales_quote_bom_lines
      set unit_price = 85.00, price_source = 'manual_override',
          price_overridden_by = spoofed_user_id,
          price_overridden_at = '2000-01-01 00:00:00+00'::timestamptz
      where id = test_bom_line_id;
    if not exists (
      select 1 from public.sales_quote_bom_lines
      where id = test_bom_line_id and price_source = 'manual_override' and unit_price = 85.00
        and price_overridden_by = quote_creator_user_id
        and price_overridden_by is distinct from spoofed_user_id
        and price_overridden_at > '2000-01-01 00:00:00+00'::timestamptz
    ) then
      raise exception 'TEST FAILED: the manual override was not stamped with the authenticated caller and database time.';
    end if;

    update public.sales_quote_bom_lines
      set price_source = 'catalog_default'
      where id = test_bom_line_id;
    if exists (
      select 1 from public.sales_quote_bom_lines
      where id = test_bom_line_id
        and (price_overridden_by is not null or price_overridden_at is not null)
    ) then
      raise exception 'TEST FAILED: reverting to catalog_default did not clear stale override attribution.';
    end if;

    -- Section 3: backfill correctness on rows that predate this migration
    -- (read-only -- this migration has already run for real in production
    -- by the time this test script is executed). Every pre-existing row
    -- must be 'legacy_unverified', NEVER 'catalog_default' -- this migration
    -- never claims an inferred historical price was verified. Our own
    -- Section 1/2 fixtures (created just above, this same transaction) are
    -- explicitly excluded so they can't accidentally satisfy this check.
    -- An empty production table is a valid state: there was nothing to
    -- backfill. In that case, prove the same legacy-safe behavior through
    -- the new columns' database defaults instead of marking a test skipped.
    select count(*) into legacy_row_count
      from public.sales_quote_bom_lines
      where id <> test_bom_line_id and quote_id <> test_quote_id and created_at < now() - interval '1 minute';
    if legacy_row_count = 0 then
      insert into public.sales_quote_bom_lines (quote_id, item_name, qty)
        values (test_quote_id, 'ZZ_TEST_LEGACY_DEFAULT_LINE', 1)
        returning id into legacy_default_line_id;
      if not exists (
        select 1
        from public.sales_quote_bom_lines bl
        where bl.id = legacy_default_line_id
          and bl.unit_price = 0
          and bl.price_source = 'legacy_unverified'
          and bl.price_overridden_by is null
          and bl.price_overridden_at is null
      ) then
        raise exception 'TEST FAILED: with no historical BOM rows to backfill, a column-default fixture did not receive the safe legacy_unverified/zero-price/null-audit state.';
      end if;
    else
      select count(*) into legacy_unverified_count
        from public.sales_quote_bom_lines
        where id <> test_bom_line_id and quote_id <> test_quote_id and created_at < now() - interval '1 minute'
          and price_source = 'legacy_unverified';
      if legacy_unverified_count <> legacy_row_count then
        raise exception 'TEST FAILED: % of % pre-existing BOM lines are NOT price_source = ''legacy_unverified'' -- the backfill mislabeled at least one row as if its price were verified.', (legacy_row_count - legacy_unverified_count), legacy_row_count;
      end if;
    end if;

    perform set_config('role', original_role, true);

    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all conversion sections (no PM user available to call create_project_from_quote as)');
    else
      -- Section 4: a quote with two proposal versions -- v1 sent (not
      -- approved), v2 approved with a real grandTotal -- converts with
      -- accepted_proposal_total equal to the APPROVED version's total,
      -- never the unapproved v1's.
      site_name := 'ZZ_TEST_ACCEPTED_TOTAL_' || substr(md5(random()::text), 1, 10);
      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status, client_id)
        values ('ZZ Test Client', site_name, 'closed_won', v_client_id)
        returning id into test_quote_id;
      -- CONSOLIDATED-SUITE FINDING (found running the full 001-185
      -- replay, not visible to migration 136's own isolated
      -- verification): migration 144 (eight migrations later) drops
      -- sales_quote_proposals' write policy entirely, by design -- see
      -- 144's own header -- so create_and_send_quote_proposal_version()
      -- becomes the only write path. A raw `insert ... as authenticated`
      -- into sales_quote_proposals, which worked when this file was
      -- written, is rejected outright under the full migration history.
      -- Pure fixture setup here (not the behavior under test), so fixed
      -- by inserting as the real table-owner role (bypasses RLS), same
      -- fix applied to migration 138's own test.
      perform set_config('role', original_role, true);
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (test_quote_id, 1, 'sent', jsonb_build_object('grandTotal', 999.00), 'ZZ Test Client', 'zz-test@example.com');
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (test_quote_id, 2, 'approved', jsonb_build_object('grandTotal', 1234.56), 'ZZ Test Client', 'zz-test@example.com');

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(test_quote_id) into result_json;
      perform set_config('role', original_role, true);

      project_id := (result_json ->> 'project_id')::uuid;
      select accepted_proposal_total into project_accepted_total from public.projects where id = project_id;
      if project_accepted_total is distinct from 1234.56 then
        raise exception 'TEST FAILED: expected accepted_proposal_total = 1234.56 (the approved v2 total), got % -- either the wrong version was read or the value was dropped.', project_accepted_total;
      end if;

      -- Section 5: idempotent retry preserves the same accepted total.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(test_quote_id) into result_json_retry;
      perform set_config('role', original_role, true);

      if (result_json_retry ->> 'project_id')::uuid is distinct from project_id then
        raise exception 'TEST FAILED: retrying create_project_from_quote for the same quote returned a different project id.';
      end if;
      select accepted_proposal_total into project_accepted_total from public.projects where id = project_id;
      if project_accepted_total is distinct from 1234.56 then
        raise exception 'TEST FAILED: retrying create_project_from_quote changed accepted_proposal_total from 1234.56 to %.', project_accepted_total;
      end if;

      -- Section 6: a quote with NO proposal at all converts successfully
      -- with a null accepted_proposal_total -- not an error, not a
      -- silently invented number.
      site_name_no_proposal := 'ZZ_TEST_NO_PROPOSAL_' || substr(md5(random()::text), 1, 10);
      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status, client_id)
        values ('ZZ Test Client', site_name_no_proposal, 'closed_won', v_client_id)
        returning id into test_quote_no_proposal_id;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(test_quote_no_proposal_id) into result_json;
      perform set_config('role', original_role, true);

      project_id_no_proposal := (result_json ->> 'project_id')::uuid;
      select accepted_proposal_total into project_accepted_total from public.projects where id = project_id_no_proposal;
      if project_accepted_total is not null then
        raise exception 'TEST FAILED: a quote with no proposal produced a project with accepted_proposal_total % -- expected null.', project_accepted_total;
      end if;

      -- Section 7 (old-snapshot compatibility): an approved proposal
      -- whose content_snapshot predates grandTotal entirely (no such key)
      -- must not crash conversion -- accepted_proposal_total stays null.
      site_name_old_snapshot := 'ZZ_TEST_OLD_SNAPSHOT_' || substr(md5(random()::text), 1, 10);
      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status, client_id)
        values ('ZZ Test Client', site_name_old_snapshot, 'closed_won', v_client_id)
        returning id into test_quote_old_snapshot_id;
      -- See the consolidated-suite finding above (migration 144 drops
      -- sales_quote_proposals' write policy) -- same fix.
      perform set_config('role', original_role, true);
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (test_quote_old_snapshot_id, 1, 'approved', jsonb_build_object('siteName', 'Old Format Snapshot'), 'ZZ Test Client', 'zz-test@example.com');

      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.create_project_from_quote(test_quote_old_snapshot_id) into result_json;
        perform set_config('role', original_role, true);
      exception when others then
        perform set_config('role', original_role, true);
        caught := true;
      end;
      if caught then
        raise exception 'TEST FAILED: converting a quote whose approved proposal has no grandTotal key crashed instead of leaving accepted_proposal_total null.';
      end if;
      project_id_old_snapshot := (result_json ->> 'project_id')::uuid;
      select accepted_proposal_total into project_accepted_total from public.projects where id = project_id_old_snapshot;
      if project_accepted_total is not null then
        raise exception 'TEST FAILED: a pre-pricing-feature approved snapshot produced a non-null accepted_proposal_total % -- expected null.', project_accepted_total;
      end if;
    end if;

    -- Section 8 (regression guard): a caller with neither admin nor pm
    -- must still be rejected -- proves this migration's redefinition
    -- didn't widen authorization.
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 8 (no same-workspace, non-admin, non-pm user found)');
    else
      site_name_denial := 'ZZ_TEST_QUOTE_DENIAL_' || substr(md5(random()::text), 1, 10);
      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', site_name_denial, 'closed_won')
        returning id into test_quote_denial_id;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        perform public.create_project_from_quote(test_quote_denial_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);

      if not caught then
        raise exception 'TEST FAILED: a non-admin, non-pm caller was able to convert a quote -- authorization gate is broken.';
      end if;
    end if;
  end if;

  -- Section 9 (no cost leakage, checked regardless of the sections above):
  -- the grant state on create_project_from_quote is unchanged -- anon still
  -- cannot execute it directly.
  select has_function_privilege('anon', 'public.create_project_from_quote(uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on create_project_from_quote(uuid) -- grant state regressed.';
  end if;

  select has_function_privilege('anon', 'public.stamp_sales_quote_price_override()', 'execute')
    into anon_can_execute;
  select has_function_privilege('authenticated', 'public.stamp_sales_quote_price_override()', 'execute')
    into authenticated_can_execute;
  if anon_can_execute or authenticated_can_execute then
    raise exception 'TEST FAILED: the trigger-only price audit function is directly executable (anon %, authenticated %).', anon_can_execute, authenticated_can_execute;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 136 SALES PRICING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

-- Transaction-safe tests for migration 146's source_quote_ref
-- carry-through addition to create_project_from_quote(). Wrapped in
-- begin;/rollback; -- nothing here ever commits. Uses REAL, already-
-- existing users for every authorization check (never fabricates a fake
-- auth.users row); every Sales Quote and project this script creates is
-- synthetic, fresh inside this same rolled-back transaction, clearly
-- named "ZZ_TEST_...". Same discipline as migration_134_client_id_
-- carry_through_tests.sql, which this script mirrors closely -- these
-- are the same kind of change (one extra column carried through the same
-- already-hardened conversion RPC).
--
-- This script does NOT re-run migration 127's full authorization matrix
-- (already exhaustively covered elsewhere, unaffected by this migration's
-- own change) -- it re-checks exactly one denial case as a regression
-- guard and otherwise focuses on what migration 146 alone changes: does
-- the source quote's quote_ref actually land on the created Project row
-- as source_quote_ref, and did the backfill correctly populate it for
-- every already-converted real project.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 146 SOURCE_QUOTE_REF
-- CARRY-THROUGH TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped. It can never quietly finish as
-- "Success. No rows returned." with something having been skipped.

begin;

do $$
declare
  admin_user_id uuid;
  pm_user_id uuid;
  quote_creator_user_id uuid;
  quote_creator_workspace_id uuid;
  non_privileged_user_id uuid;
  original_role text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  site_name text;
  site_name_denial text;
  quote_id uuid;
  quote_denial_id uuid;
  expected_ref text;

  result_json jsonb;
  result_json_retry jsonb;
  project_id uuid;
  project_source_quote_ref text;
  project_count_before integer;
  project_count_after integer;
  caught boolean;

  backfill_mismatch_count integer;
begin
  select current_setting('role') into original_role;

  -- Section 0 (checked regardless, read-only, no fixtures needed): every
  -- already-converted real project's source_quote_ref matches its real
  -- source quote's quote_ref -- proves the backfill UPDATE ran correctly
  -- against actual production data, not just fresh test fixtures.
  select count(*) into backfill_mismatch_count
  from public.projects p
  join public.sales_quotes sq on sq.id = p.source_sales_quote_id
  where p.source_sales_quote_id is not null
    and p.source_quote_ref is distinct from sq.quote_ref;
  if backfill_mismatch_count > 0 then
    raise exception 'TEST FAILED: % already-converted project(s) have a source_quote_ref that does not match their real source quote''s quote_ref -- the backfill did not run correctly.', backfill_mismatch_count;
  end if;

  select user_id into admin_user_id from public.app_admins limit 1;
  select wm.user_id, wm.workspace_id into quote_creator_user_id, quote_creator_workspace_id
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where w.status = 'active'
    limit 1;

  if admin_user_id is null or quote_creator_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user or no active-workspace member found)');
  elsif not exists (
    select 1 from public.workspace_members wm
    where wm.user_id = admin_user_id and wm.workspace_id = quote_creator_workspace_id
  ) then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (the admin user is not a member of the active workspace used for this test run)');
  else
    select wm.user_id into pm_user_id
      from public.workspace_members wm
      join public.workspace_member_roles wmr on wmr.workspace_member_id = wm.id
      where wm.workspace_id = quote_creator_workspace_id
        and wmr.role_key = 'pm'
        and wm.user_id not in (select user_id from public.app_admins)
      limit 1;
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

    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Sections 1-2 (no PM user available to call create_project_from_quote as)');
    else
      site_name := 'ZZ_TEST_QUOTE_REF_' || substr(md5(random()::text), 1, 10);

      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', site_name, 'closed_won')
        returning id into quote_id;
      perform set_config('role', original_role, true);

      -- quote_ref is trigger-assigned (migration 066) and NOT NULL/unique
      -- -- every quote has one, unlike the optional client_id migration
      -- 134's test covers, so there is no "without a ref" case to test.
      select quote_ref into expected_ref from public.sales_quotes where id = quote_id;
      if expected_ref is null then
        raise exception 'TEST FAILED: the fixture quote has no quote_ref -- migration 066''s trigger should have assigned one unconditionally.';
      end if;

      -- Section 1: converting the quote carries its quote_ref onto the
      -- created Project's source_quote_ref.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_id) into result_json;
      perform set_config('role', original_role, true);

      project_id := (result_json ->> 'project_id')::uuid;
      select source_quote_ref into project_source_quote_ref from public.projects where id = project_id;

      if project_source_quote_ref is distinct from expected_ref then
        raise exception 'TEST FAILED: converting quote with quote_ref % produced a project with source_quote_ref % -- expected them to match.', expected_ref, project_source_quote_ref;
      end if;

      -- Section 2: idempotent retry does not change source_quote_ref (and
      -- still reports already_existed = true, same project id) --
      -- mirrors migration 134's own idempotency check for client_id.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_id) into result_json_retry;
      perform set_config('role', original_role, true);

      if (result_json_retry ->> 'project_id')::uuid is distinct from project_id then
        raise exception 'TEST FAILED: retrying create_project_from_quote for the same quote returned a different project id.';
      end if;
      if not (result_json_retry ->> 'already_existed')::boolean then
        raise exception 'TEST FAILED: retrying create_project_from_quote did not report already_existed = true.';
      end if;

      select source_quote_ref into project_source_quote_ref from public.projects where id = project_id;
      if project_source_quote_ref is distinct from expected_ref then
        raise exception 'TEST FAILED: retrying create_project_from_quote changed the project''s source_quote_ref from % to %.', expected_ref, project_source_quote_ref;
      end if;
    end if;

    -- Section 3 (regression guard, not a re-test of the full matrix): a
    -- caller with neither admin nor pm must still be rejected, and must
    -- create nothing -- proves this migration's own change didn't widen
    -- authorization.
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 3 (no same-workspace, non-admin, non-pm user found)');
    else
      site_name_denial := 'ZZ_TEST_QUOTE_REF_DENIAL_' || substr(md5(random()::text), 1, 10);

      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', site_name_denial, 'closed_won')
        returning id into quote_denial_id;
      perform set_config('role', original_role, true);

      select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_denial_id;

      perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        perform public.create_project_from_quote(quote_denial_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);

      select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_denial_id;

      if not caught then
        raise exception 'TEST FAILED: a non-admin, non-pm caller was able to convert a quote -- authorization gate is broken.';
      end if;
      if project_count_after <> project_count_before then
        raise exception 'TEST FAILED: a rejected conversion attempt still created a project row.';
      end if;
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 146 SOURCE_QUOTE_REF CARRY-THROUGH TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

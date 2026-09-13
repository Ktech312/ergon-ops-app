-- Transaction-safe tests for migration 134's client_id carry-through
-- addition to create_project_from_quote(). Wrapped in begin;/rollback; --
-- nothing here ever commits. Uses REAL, already-existing users for every
-- authorization check (never fabricates a fake auth.users row, never
-- destructively mutates a real user's real workspace membership -- a
-- temporary 'pm' role grant is added only when genuinely missing and
-- would be removed before continuing if this script didn't roll back
-- regardless), same discipline as migration_127_conversion_tests.sql.
-- Every Sales Quote, client, and project this script creates is
-- synthetic, fresh inside this same rolled-back transaction, clearly
-- named "ZZ_TEST_...".
--
-- This script does NOT re-run migration 127's full authorization matrix
-- (already exhaustively covered by migration_127_conversion_tests.sql,
-- unaffected by this migration's own change) -- it re-checks exactly one
-- denial case as a regression guard (a non-admin/non-pm caller must
-- still be rejected) and otherwise focuses on what migration 134 alone
-- changes: does the source quote's client_id actually land on the
-- created Project row.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 134 CLIENT_ID CARRY-
-- THROUGH TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped. It can never quietly finish as
-- "Success. No rows returned." with something having been skipped.

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

  -- Named v_client_id, not client_id, on purpose -- a bare `client_id`
  -- variable would collide with the real client_id column this script
  -- reads back from both sales_quotes and projects, and PL/pgSQL's
  -- default variable_conflict='error' setting would turn every such
  -- SELECT into a hard "column reference is ambiguous" error rather
  -- than silently picking the wrong one. Found and fixed before this
  -- script was ever run, the same class of bug flagged in migration
  -- 130's own test script review.
  v_client_id uuid;
  quote_with_client_id uuid;
  quote_without_client_id uuid;
  quote_denial_id uuid;
  site_name_with text;
  site_name_without text;
  site_name_denial text;

  result_json jsonb;
  result_json_retry jsonb;
  project_id_with uuid;
  project_id_without uuid;
  project_client_id uuid;
  project_count_before integer;
  project_count_after integer;
  caught boolean;
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
  elsif not exists (
    select 1 from public.workspace_members wm
    where wm.user_id = admin_user_id and wm.workspace_id = quote_creator_workspace_id
  ) then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (the admin user is not a member of the active workspace used for this test run)');
  else
    -- Same PM-fixture-discovery pattern as migration_127_conversion_tests.sql.
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

    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all client_id sections (no PM user available to call create_project_from_quote as)');
    else
      -- Fixtures: one synthetic client, one quote WITH that client_id, one
      -- quote WITHOUT (client_id left null), created as a real
      -- active-workspace member so the workspace_id-derivation trigger
      -- succeeds.
      site_name_with := 'ZZ_TEST_QUOTE_WITH_CLIENT_' || substr(md5(random()::text), 1, 10);
      site_name_without := 'ZZ_TEST_QUOTE_NO_CLIENT_' || substr(md5(random()::text), 1, 10);

      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);

      insert into public.clients (name) values ('ZZ_TEST_CLIENT_' || substr(md5(random()::text), 1, 10))
        returning id into v_client_id;

      insert into public.sales_quotes (client_name, site_name, status, client_id)
        values ('ZZ Test Client', site_name_with, 'closed_won', v_client_id)
        returning id into quote_with_client_id;

      insert into public.sales_quotes (client_name, site_name, status, client_id)
        values ('ZZ Test Client', site_name_without, 'closed_won', null)
        returning id into quote_without_client_id;

      perform set_config('role', original_role, true);

      -- Section 1: converting a quote WITH a client_id carries it onto
      -- the created Project row.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_with_client_id) into result_json;
      perform set_config('role', original_role, true);

      project_id_with := (result_json ->> 'project_id')::uuid;
      select client_id into project_client_id from public.projects where id = project_id_with;

      if project_client_id is distinct from v_client_id then
        raise exception 'TEST FAILED: converting a quote with client_id % produced a project with client_id % -- expected them to match.', v_client_id, project_client_id;
      end if;

      -- Section 2: idempotent retry does not change the client_id (and
      -- still reports already_existed = true, same project id).
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_with_client_id) into result_json_retry;
      perform set_config('role', original_role, true);

      if (result_json_retry ->> 'project_id')::uuid is distinct from project_id_with then
        raise exception 'TEST FAILED: retrying create_project_from_quote for the same quote returned a different project id.';
      end if;
      if not (result_json_retry ->> 'already_existed')::boolean then
        raise exception 'TEST FAILED: retrying create_project_from_quote did not report already_existed = true.';
      end if;

      select client_id into project_client_id from public.projects where id = project_id_with;
      if project_client_id is distinct from v_client_id then
        raise exception 'TEST FAILED: retrying create_project_from_quote changed the project''s client_id from % to %.', v_client_id, project_client_id;
      end if;

      -- Section 3: converting a quote WITHOUT a client_id still converts
      -- successfully, with a null client_id on the project (not an
      -- error, not a silently-invented value).
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_without_client_id) into result_json;
      perform set_config('role', original_role, true);

      project_id_without := (result_json ->> 'project_id')::uuid;
      select client_id into project_client_id from public.projects where id = project_id_without;
      if project_client_id is not null then
        raise exception 'TEST FAILED: converting a quote with no client_id produced a project with client_id % -- expected null.', project_client_id;
      end if;
    end if;

    -- Section 4 (regression guard, not a re-test of the full matrix):
    -- a caller with neither admin nor pm must still be rejected, and
    -- must create nothing -- proves this migration's own change didn't
    -- widen authorization.
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 4 (no same-workspace, non-admin, non-pm user found)');
    else
      site_name_denial := 'ZZ_TEST_QUOTE_DENIAL_' || substr(md5(random()::text), 1, 10);

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

  raise notice 'ALL MIGRATION 134 CLIENT_ID CARRY-THROUGH TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

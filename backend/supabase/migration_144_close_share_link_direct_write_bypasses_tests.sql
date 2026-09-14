-- Transaction-safe tests for migration 144's direct-write closure on
-- public_share_tokens/project_submittals/sales_quote_proposals. Wrapped in
-- begin;/rollback; -- nothing here ever commits. Fixture creation runs as
-- the script's own original (superuser) role, which bypasses RLS
-- regardless of this migration -- exactly matching every other test
-- script's established convention in this repo; the actual rejection
-- checks below always impersonate a real authenticated user via
-- set_config, the same "real authenticated REST rejection" this migration's
-- own header requires proof of. Requires migrations 137-140 (+ corrective
-- 141/142) and 143 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 144 DIRECT-WRITE CLOSURE
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming what
-- failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  pm_user_id uuid;
  sales_user_id uuid;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  test_project_id uuid;
  test_submittal_id uuid;
  test_quote_id uuid;
  test_proposal_id uuid;
  fixture_token text := 'ZZ_TEST_144_TOKEN_' || substr(md5(random()::text), 1, 12);

  caught boolean;
  affected_rows integer;
  read_count integer;
  rpc_submittal_id uuid;
  rpc_token text;
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    select ur.user_id into pm_user_id
    from public.app_user_roles ur
    where ur.role_key = 'pm'
      and not exists (select 1 from public.app_admins aa where aa.user_id = ur.user_id)
    limit 1;
    if pm_user_id is null then
      select wm.user_id into pm_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) limit 1;
      if pm_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'pm', false) on conflict do nothing;
      end if;
    end if;

    select ur.user_id into sales_user_id
    from public.app_user_roles ur
    where ur.role_key = 'sales'
      and not exists (select 1 from public.app_admins aa where aa.user_id = ur.user_id)
    limit 1;
    if sales_user_id is null then
      select wm.user_id into sales_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        limit 1;
      if sales_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (sales_user_id, 'sales', false) on conflict do nothing;
      end if;
    end if;

    if pm_user_id is null or sales_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all-sections (no real PM/Sales user found or grantable)');
    else
      -- Fixtures run as the script's own (superuser) role throughout --
      -- bypasses RLS regardless of this migration, which is deliberate
      -- and required here: this migration removes project_submittals'/
      -- sales_quote_proposals' only write policies entirely, so actually
      -- switching role to 'authenticated' (even as admin) for these
      -- inserts would now correctly be rejected by the very thing this
      -- test proves. Only the jwt claim GUCs are set (admin's id), never
      -- `role` itself, so sales_quotes' migration-117 workspace-ownership
      -- trigger still resolves a real auth.uid() with a real workspace
      -- membership -- auth.uid() reads only those GUCs, never `role`.
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);

      insert into public.projects (project_name, customer_name, site_type, app_status)
        values ('ZZ_TEST_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Test Client', 'Parking Garage', 'Draft')
        returning id into test_project_id;
      insert into public.project_submittals (project_id, version, status, content_snapshot)
        values (test_project_id, 1, 'sent', '{}'::jsonb)
        returning id into test_submittal_id;

      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into test_quote_id;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot)
        values (test_quote_id, 1, 'sent', '{}'::jsonb)
        returning id into test_proposal_id;

      insert into public.public_share_tokens (token, entity_type, entity_id)
        values (fixture_token, 'project_submittal', test_submittal_id);

      perform set_config('role', original_role, true);

      -- Section 1: a real authenticated PM cannot directly INSERT into
      -- public_share_tokens anymore -- no policy grants it regardless of
      -- role, so the INSERT's WITH CHECK fails outright.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        insert into public.public_share_tokens (token, entity_type, entity_id)
          values ('ZZ_SHOULD_NEVER_EXIST_144', 'project_submittal', test_submittal_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a real authenticated PM was able to directly INSERT a public_share_tokens row -- the direct-write bypass is not closed.';
      end if;

      -- Section 2: a real authenticated admin cannot directly UPDATE a
      -- public_share_tokens row either -- RLS filters it to zero matching
      -- rows (no exception; the established "0 rows affected via the
      -- USING clause" rejection shape, matching migration 137's own test
      -- convention for this exact pattern).
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      update public.public_share_tokens set expires_at = now() where token = fixture_token;
      get diagnostics affected_rows = row_count;
      perform set_config('role', original_role, true);
      if affected_rows <> 0 then
        raise exception 'TEST FAILED: a real authenticated admin was able to directly UPDATE a public_share_tokens row (% rows affected) -- the direct-write bypass is not closed.', affected_rows;
      end if;

      -- Section 3: read access is unaffected -- the same PM can still
      -- SELECT the fixture token row.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into read_count from public.public_share_tokens where token = fixture_token;
      perform set_config('role', original_role, true);
      if read_count <> 1 then
        raise exception 'TEST FAILED: a real authenticated PM could not read the public_share_tokens fixture row after the write policy was narrowed -- read access must be unaffected.';
      end if;

      -- Section 4: a real authenticated PM cannot directly INSERT into
      -- project_submittals anymore, even though the OLD policy would have
      -- allowed exactly this role.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        insert into public.project_submittals (project_id, version, status, content_snapshot)
          values (test_project_id, 999, 'sent', '{}'::jsonb);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a real authenticated PM was able to directly INSERT a project_submittals row -- the direct-write bypass is not closed.';
      end if;

      -- Section 5: a real authenticated Sales user cannot directly INSERT
      -- into sales_quote_proposals anymore -- the pre-migration-144 policy
      -- allowed ANY authenticated user, not just Sales, making this the
      -- most important rejection to prove.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot)
          values (test_quote_id, 999, 'sent', '{}'::jsonb);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a real authenticated Sales user was able to directly INSERT a sales_quote_proposals row -- the direct-write bypass is not closed.';
      end if;

      -- Section 6: read access on project_submittals/sales_quote_proposals
      -- is unaffected (their own separate "authenticated read" policies,
      -- untouched by this migration).
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into read_count from public.project_submittals where id = test_submittal_id;
      if read_count <> 1 then
        perform set_config('role', original_role, true);
        raise exception 'TEST FAILED: a real authenticated Sales user could not read the project_submittals fixture row -- read access must be unaffected.';
      end if;
      select count(*) into read_count from public.sales_quote_proposals where id = test_proposal_id;
      perform set_config('role', original_role, true);
      if read_count <> 1 then
        raise exception 'TEST FAILED: a real authenticated Sales user could not read the sales_quote_proposals fixture row -- read access must be unaffected.';
      end if;

      -- Section 7: the sanctioned RPC path still works end-to-end after
      -- the direct-write bypass is closed -- create_and_send_submittal_version
      -- is security definer and must be completely unaffected by this
      -- migration's RLS changes.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select t.submittal_id, t.token into rpc_submittal_id, rpc_token
        from public.create_and_send_submittal_version(test_project_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);
      if rpc_submittal_id is null or rpc_token is null then
        raise exception 'TEST FAILED: create_and_send_submittal_version stopped working after the direct-write bypass was closed -- the sanctioned RPC path must be completely unaffected.';
      end if;
      if not exists (select 1 from public.project_submittals where id = rpc_submittal_id and version = 2) then
        raise exception 'TEST FAILED: create_and_send_submittal_version''s real write did not persist correctly after the direct-write bypass was closed.';
      end if;
      -- No temporary-role-grant cleanup needed here -- any fallback grant
      -- made above (if a real PM/Sales user wasn't found) is rolled back
      -- along with everything else by this script's own trailing
      -- rollback; -- moot, unlike a committing migration.
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 144 DIRECT-WRITE CLOSURE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

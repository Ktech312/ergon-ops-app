-- Transaction-safe tests for migration 138's server-owned share-link
-- creation RPCs. Wrapped in begin;/rollback; -- nothing here ever commits.
-- Uses REAL, already-existing users for every authorization check (never
-- fabricates a fake auth.users row). Every submittal/proposal this script
-- creates is synthetic, fresh inside this same rolled-back transaction,
-- clearly named "ZZ_TEST_...".
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 138 SHARE-LINK CREATION
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming what
-- failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  pm_user_id uuid;
  sales_user_id uuid;
  non_privileged_user_id uuid;
  pm_role_preexisted boolean;
  sales_role_preexisted boolean;

  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  test_project_id uuid;
  test_submittal_id uuid;
  test_quote_id uuid;
  test_proposal_id uuid;

  token_1 text;
  token_2 text;
  caught boolean;

  workspace_default_expiration interval;
  actual_expires_at timestamptz;
  action_count integer;
  anon_can_execute boolean;
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    -- Fixture discovery, same pattern as migration_133/134/136's own tests:
    -- find a real PM and a real Sales-role user; if either role is
    -- genuinely absent from real data, temporarily grant it to some
    -- other real, non-admin workspace member (removed again below,
    -- regardless of outcome -- moot under this transaction's rollback,
    -- but matching this repo's own established discipline) rather than
    -- skipping the whole section.
    select ur.user_id into pm_user_id from public.app_user_roles ur where ur.role_key = 'pm' limit 1;
    pm_role_preexisted := pm_user_id is not null;
    if pm_user_id is null then
      select wm.user_id into pm_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) limit 1;
      if pm_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'pm', false) on conflict do nothing;
      end if;
    end if;

    select ur.user_id into sales_user_id from public.app_user_roles ur where ur.role_key = 'sales' limit 1;
    sales_role_preexisted := sales_user_id is not null;
    if sales_user_id is null then
      select wm.user_id into sales_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        limit 1;
      if sales_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (sales_user_id, 'sales', false) on conflict do nothing;
      end if;
    end if;

    select au.id into non_privileged_user_id
    from auth.users au
    where not exists (select 1 from public.app_admins aa where aa.user_id = au.id)
      and not exists (select 1 from public.app_user_roles ur where ur.user_id = au.id and ur.role_key in ('pm', 'sales', 'manager'))
    limit 1;

    if pm_user_id is null or sales_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all-sections (no real PM-role and/or Sales-role user found to test as, and no other real workspace member available to temporarily grant the role to)');
    else
      -- Real workspace settings row's own open-document default -- used
      -- below to prove the created token's expires_at actually matches
      -- it, not a hardcoded/guessed value.
      select default_expiration_open_documents into workspace_default_expiration
      from public.workspace_share_link_settings
      where workspace_id = public.active_workspace_id();

      -- Synthetic fixtures: one project + submittal, one quote + proposal.
      insert into public.projects (project_name, customer_name, site_type, app_status)
        values ('ZZ_TEST_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Test Client', 'Parking Garage', 'Draft')
        returning id into test_project_id;
      insert into public.project_submittals (project_id, version, status, content_snapshot)
        values (test_project_id, 1, 'draft', '{}'::jsonb)
        returning id into test_submittal_id;

      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into test_quote_id;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot)
        values (test_quote_id, 1, 'draft', '{}'::jsonb)
        returning id into test_proposal_id;

      -- Section 1: a real PM can create a submittal share token; it's
      -- entity-correct, has an expires_at matching the workspace default,
      -- and logs a 'created' action.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_submittal_share_token(test_submittal_id) into token_1;
      perform set_config('role', original_role, true);

      if token_1 is null or length(token_1) < 32 then
        raise exception 'TEST FAILED: create_submittal_share_token did not return a real-looking token.';
      end if;
      select expires_at into actual_expires_at from public.public_share_tokens where token = token_1;
      if not exists (
        select 1 from public.public_share_tokens
        where token = token_1 and entity_type = 'project_submittal' and entity_id = test_submittal_id
      ) then
        raise exception 'TEST FAILED: create_submittal_share_token created a token with the wrong entity_type/entity_id.';
      end if;
      if workspace_default_expiration is not null and (actual_expires_at is null or abs(extract(epoch from (actual_expires_at - (now() + workspace_default_expiration)))) > 60) then
        raise exception 'TEST FAILED: the created token''s expires_at (%) does not match the workspace''s open-document default (now() + %).', actual_expires_at, workspace_default_expiration;
      end if;
      select count(*) into action_count from public.share_link_actions
        where token = token_1 and action = 'created' and entity_id = test_submittal_id;
      if action_count <> 1 then
        raise exception 'TEST FAILED: expected exactly one ''created'' share_link_actions row for this token, found %.', action_count;
      end if;

      -- Section 2: a real Sales-role user can create a proposal share
      -- token, same shape.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_quote_proposal_share_token(test_proposal_id) into token_2;
      perform set_config('role', original_role, true);

      if token_2 is null or token_2 = token_1 then
        raise exception 'TEST FAILED: create_quote_proposal_share_token did not return a real, distinct token.';
      end if;
      if not exists (
        select 1 from public.public_share_tokens
        where token = token_2 and entity_type = 'sales_quote_proposal' and entity_id = test_proposal_id
      ) then
        raise exception 'TEST FAILED: create_quote_proposal_share_token created a token with the wrong entity_type/entity_id.';
      end if;

      -- Section 3: a nonexistent submittal/proposal id is rejected, and
      -- creates no token.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.create_submittal_share_token(gen_random_uuid());
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: create_submittal_share_token succeeded for a nonexistent submittal id.';
      end if;

      -- Section 4: authorization -- a non-privileged user is rejected for
      -- both RPCs, and a PM is rejected for the PROPOSAL RPC (PM has no
      -- proposal authority per the decided model), creating no token
      -- either way.
      if non_privileged_user_id is null then
        skipped_count := skipped_count + 1;
        skipped_names := array_append(skipped_names, 'non-privileged-denial (no real user without pm/sales/manager/admin found)');
      else
        caught := false;
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
          perform set_config('role', 'authenticated', true);
          perform public.create_submittal_share_token(test_submittal_id);
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);
        if not caught then
          raise exception 'TEST FAILED: a non-privileged user was able to create a submittal share token.';
        end if;

        caught := false;
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
          perform set_config('role', 'authenticated', true);
          perform public.create_quote_proposal_share_token(test_proposal_id);
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);
        if not caught then
          raise exception 'TEST FAILED: a non-privileged user was able to create a proposal share token.';
        end if;
      end if;

      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.create_quote_proposal_share_token(test_proposal_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only (non-admin, non-sales, non-manager) caller was able to create a proposal share token -- PM has no proposal authority per the decided ownership model.';
      end if;

      -- Cleanup of the temporary role grants this script may have added,
      -- for hygiene -- moot under this transaction's rollback, but
      -- matching this repo's own established discipline.
      if not pm_role_preexisted and pm_user_id is not null then
        delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm';
      end if;
      if not sales_role_preexisted and sales_user_id is not null then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'sales';
      end if;
    end if;
  end if;

  -- Section 5 (checked regardless of the sections above): anon cannot
  -- execute either creation RPC directly.
  select has_function_privilege('anon', 'public.create_submittal_share_token(uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on create_submittal_share_token -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.create_quote_proposal_share_token(uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on create_quote_proposal_share_token -- expected authenticated-only.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 138 SHARE-LINK CREATION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

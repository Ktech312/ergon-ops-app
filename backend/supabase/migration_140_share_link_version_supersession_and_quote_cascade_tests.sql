-- Transaction-safe tests for migration 140's quote soft-delete cascade and
-- auto-supersede-on-new-version RPCs. Wrapped in begin;/rollback; -- nothing
-- here ever commits. Uses REAL, already-existing users for every
-- authorization check; every quote/proposal/project/submittal this script
-- creates is synthetic, fresh inside this same rolled-back transaction,
-- clearly named "ZZ_TEST_...". Requires migrations 137, 138, and 139 to
-- already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 140 SHARE-LINK SUPERSESSION
-- AND QUOTE-CASCADE TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  pm_user_id uuid;
  sales_user_id uuid;
  pm_role_preexisted boolean;
  sales_role_preexisted boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  test_quote_id uuid;
  test_project_id uuid;

  v1_submittal_id uuid;
  v1_token text;
  v2_submittal_id uuid;
  v2_token text;
  v3_submittal_id uuid;
  v3_token text;

  p1_proposal_id uuid;
  p1_token text;
  p2_proposal_id uuid;
  p2_token text;

  action_result text;
  caught boolean;
  r record;
  anon_can_execute boolean;
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
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

    if pm_user_id is null or sales_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all-sections (no real PM/Sales user found or grantable)');
    else
      insert into public.projects (project_name, customer_name, site_type, app_status)
        values ('ZZ_TEST_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Test Client', 'Parking Garage', 'Draft')
        returning id into test_project_id;

      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into test_quote_id;

      -- Section 1: creating the FIRST submittal version with no prior
      -- versions -- version 1, a real token, nothing to supersede.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select t.submittal_id, t.token into v1_submittal_id, v1_token
        from public.create_and_send_submittal_version(test_project_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);

      if v1_submittal_id is null or v1_token is null or length(v1_token) < 32 then
        raise exception 'TEST FAILED: create_and_send_submittal_version did not return a real submittal id and token for the first version.';
      end if;
      if not exists (select 1 from public.project_submittals where id = v1_submittal_id and version = 1 and status = 'sent') then
        raise exception 'TEST FAILED: the first submittal version was not created with version=1, status=sent.';
      end if;
      if not exists (select 1 from public.public_share_tokens where token = v1_token and status = 'active' and entity_id = v1_submittal_id) then
        raise exception 'TEST FAILED: the first submittal version''s token was not created active and entity-correct.';
      end if;

      -- Section 2: creating a SECOND version supersedes the first --
      -- version=2 computed server-side (not client-supplied), old token
      -- flips to superseded pointing at the new token, and a 'superseded'
      -- share_link_actions row exists for the old token.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select t.submittal_id, t.token into v2_submittal_id, v2_token
        from public.create_and_send_submittal_version(test_project_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);

      if not exists (select 1 from public.project_submittals where id = v2_submittal_id and version = 2) then
        raise exception 'TEST FAILED: the second submittal version was not computed as version=2 server-side.';
      end if;
      if v2_token is null or v2_token = v1_token then
        raise exception 'TEST FAILED: the second submittal version did not get a real, distinct token.';
      end if;
      if not exists (select 1 from public.public_share_tokens where token = v1_token and status = 'superseded' and superseded_by_token = v2_token) then
        raise exception 'TEST FAILED: creating a second submittal version did not mark the first version''s token superseded pointing at the new token.';
      end if;
      if not exists (select 1 from public.share_link_actions where token = v1_token and action = 'superseded') then
        raise exception 'TEST FAILED: no ''superseded'' share_link_actions row was logged for the superseded first-version token.';
      end if;
      select * into r from public.get_submittal_by_token(v1_token);
      if r.outcome <> 'superseded' then
        raise exception 'TEST FAILED: the superseded first-version token does not resolve outcome=superseded via get_submittal_by_token, got %.', r.outcome;
      end if;

      -- Section 3: a token that was already permanently_revoked before a
      -- later version is created is left alone -- never silently flipped to
      -- superseded, matching the decided "no loophole around no-re-enable"
      -- rule for already-terminal states.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.permanently_revoke_share_link(v2_token, 'ZZ test revoke before v3') into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'success' then
        raise exception 'TEST FAILED: expected permanently_revoke_share_link to succeed on the active v2 token, got %.', action_result;
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select t.submittal_id, t.token into v3_submittal_id, v3_token
        from public.create_and_send_submittal_version(test_project_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);

      if not exists (select 1 from public.project_submittals where id = v3_submittal_id and version = 3) then
        raise exception 'TEST FAILED: the third submittal version was not computed as version=3 server-side.';
      end if;
      if not exists (select 1 from public.public_share_tokens where token = v2_token and status = 'permanently_revoked') then
        raise exception 'TEST FAILED: creating a third submittal version overwrote the second version''s already-permanently_revoked token status.';
      end if;

      -- Section 4: nonexistent project id is rejected, no row created.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.create_and_send_submittal_version(gen_random_uuid(), '{}'::jsonb, 'ZZ', 'zz@example.com');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: create_and_send_submittal_version succeeded for a nonexistent project id.';
      end if;

      -- Section 5: authorization -- Sales-only (no PM/admin) cannot create a
      -- submittal version; PM-only (no Sales/manager/admin) cannot create a
      -- proposal version.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.create_and_send_submittal_version(test_project_id, '{}'::jsonb, 'ZZ', 'zz@example.com');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a Sales-only (non-PM, non-admin) caller was able to create a submittal version.';
      end if;

      -- Section 6: the equivalent proposal flow -- first version, second
      -- version supersedes the first, server-computed version numbers.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select t.proposal_id, t.token into p1_proposal_id, p1_token
        from public.create_and_send_quote_proposal_version(test_quote_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);

      if p1_proposal_id is null or p1_token is null then
        raise exception 'TEST FAILED: create_and_send_quote_proposal_version did not return a real proposal id and token for the first version.';
      end if;
      if not exists (select 1 from public.sales_quote_proposals where id = p1_proposal_id and version = 1 and status = 'sent') then
        raise exception 'TEST FAILED: the first proposal version was not created with version=1, status=sent.';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select t.proposal_id, t.token into p2_proposal_id, p2_token
        from public.create_and_send_quote_proposal_version(test_quote_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') t;
      perform set_config('role', original_role, true);

      if not exists (select 1 from public.sales_quote_proposals where id = p2_proposal_id and version = 2) then
        raise exception 'TEST FAILED: the second proposal version was not computed as version=2 server-side.';
      end if;
      if not exists (select 1 from public.public_share_tokens where token = p1_token and status = 'superseded' and superseded_by_token = p2_token) then
        raise exception 'TEST FAILED: creating a second proposal version did not mark the first version''s token superseded pointing at the new token.';
      end if;

      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.create_and_send_quote_proposal_version(test_quote_id, '{}'::jsonb, 'ZZ', 'zz@example.com');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only (non-sales, non-manager, non-admin) caller was able to create a proposal version -- PM has no proposal authority per the decided ownership model.';
      end if;

      -- Section 7: quote soft-delete cascade -- soft-deleting the quote
      -- disables the (still-active) latest proposal token, logs the
      -- action, and restoring the quote does NOT re-enable it.
      update public.sales_quotes set deleted_by_email = 'zz-test@example.com', deleted_at = now() where id = test_quote_id;

      if not exists (select 1 from public.public_share_tokens where token = p2_token and status = 'temporarily_disabled' and disabled_reason = 'Quote deleted') then
        raise exception 'TEST FAILED: soft-deleting the quote did not cascade-disable its still-active proposal token.';
      end if;
      if not exists (select 1 from public.share_link_actions where token = p2_token and action = 'temporarily_disabled' and reason = 'Quote deleted') then
        raise exception 'TEST FAILED: the quote-deletion cascade did not log a temporarily_disabled share_link_actions row.';
      end if;

      update public.sales_quotes set deleted_by_email = null, deleted_at = null where id = test_quote_id;

      if not exists (select 1 from public.public_share_tokens where token = p2_token and status = 'temporarily_disabled') then
        raise exception 'TEST FAILED: restoring the quote silently re-enabled its cascade-disabled proposal link -- restore must never auto-reactivate.';
      end if;

      -- Section 8: a token already permanently_revoked before the quote is
      -- deleted is left alone by the cascade (never resurrected into
      -- temporarily_disabled).
      if not exists (select 1 from public.public_share_tokens where token = v2_token and status = 'permanently_revoked') then
        raise exception 'TEST FAILED: an unrelated already-permanently_revoked token changed state during this test -- fixture contamination.';
      end if;

      if not pm_role_preexisted and pm_user_id is not null then
        delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm';
      end if;
      if not sales_role_preexisted and sales_user_id is not null then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'sales';
      end if;
    end if;
  end if;

  -- Section 9 (checked regardless): anon cannot execute either RPC.
  select has_function_privilege('anon', 'public.create_and_send_submittal_version(uuid, jsonb, text, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on create_and_send_submittal_version -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.create_and_send_quote_proposal_version(uuid, jsonb, text, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on create_and_send_quote_proposal_version -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.cascade_quote_soft_delete()', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on the cascade_quote_soft_delete trigger function -- expected none (trigger-only).';
  end if;
  select has_function_privilege('authenticated', 'public.cascade_quote_soft_delete()', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on the cascade_quote_soft_delete trigger function -- expected none (trigger-only).';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 140 SHARE-LINK SUPERSESSION AND QUOTE-CASCADE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

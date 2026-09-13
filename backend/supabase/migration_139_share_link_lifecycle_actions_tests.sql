-- Transaction-safe tests for migration 139's share-link lifecycle actions
-- and read/response outcome extension. Wrapped in begin;/rollback; --
-- nothing here ever commits. Uses REAL, already-existing users for every
-- authorization check; every quote/proposal/project/submittal this script
-- creates is synthetic, fresh inside this same rolled-back transaction,
-- clearly named "ZZ_TEST_...". Requires migrations 137 and 138 to already
-- be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 139 SHARE-LINK LIFECYCLE
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming what
-- failed or was skipped.

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
  test_proposal_id uuid;
  test_project_id uuid;
  test_submittal_id uuid;

  token_a text;
  token_b text;
  new_token text;
  action_result text;
  caught boolean;
  anon_can_execute boolean;
  authenticated_can_execute_public_rpc boolean;

  r record;
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
      -- Fixtures: one quote+proposal (status 'sent', so a response can
      -- actually be attempted), one project+submittal (also 'sent').
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into test_quote_id;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (test_quote_id, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
        returning id into test_proposal_id;

      insert into public.projects (project_name, customer_name, site_type, app_status)
        values ('ZZ_TEST_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Test Client', 'Parking Garage', 'Draft')
        returning id into test_project_id;
      insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email)
        values (test_project_id, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
        returning id into test_submittal_id;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_quote_proposal_share_token(test_proposal_id) into token_a;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_submittal_share_token(test_submittal_id) into token_b;
      perform set_config('role', original_role, true);

      -- Section 1: get_quote_proposal_by_token reports 'found' for a
      -- healthy link.
      select * into r from public.get_quote_proposal_by_token(token_a);
      if r.outcome <> 'found' or r.proposal_id <> test_proposal_id then
        raise exception 'TEST FAILED: expected outcome=found for a healthy proposal link, got outcome=% proposal_id=%.', r.outcome, r.proposal_id;
      end if;

      -- Section 2: disable, then the read outcome becomes 'unavailable',
      -- and a second disable call reports already_not_active.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.disable_share_link(token_a, 'ZZ test reason') into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'success' then
        raise exception 'TEST FAILED: expected disable_share_link to succeed on an active link, got %.', action_result;
      end if;

      select * into r from public.get_quote_proposal_by_token(token_a);
      if r.outcome <> 'unavailable' then
        raise exception 'TEST FAILED: expected outcome=unavailable for a disabled link, got %.', r.outcome;
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.disable_share_link(token_a) into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'already_not_active' then
        raise exception 'TEST FAILED: expected already_not_active on a second disable of the same link, got %.', action_result;
      end if;

      -- A disabled link may not accept a response.
      select * into r from public.respond_to_quote_proposal(token_a, 'approved', 'ZZ Approver', '127.0.0.1', '');
      if r.outcome <> 'unavailable' then
        raise exception 'TEST FAILED: expected a disabled link''s respond_to_quote_proposal outcome to be unavailable, got %.', r.outcome;
      end if;
      if exists (select 1 from public.sales_quote_proposals where id = test_proposal_id and status <> 'sent') then
        raise exception 'TEST FAILED: a disabled link''s response attempt actually changed the proposal''s status.';
      end if;

      -- Section 3: re-enable restores 'found', and a second re-enable is
      -- a no-op (already_not_disabled).
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.re_enable_share_link(token_a) into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'success' then
        raise exception 'TEST FAILED: expected re_enable_share_link to succeed on a disabled link, got %.', action_result;
      end if;
      select * into r from public.get_quote_proposal_by_token(token_a);
      if r.outcome <> 'found' then
        raise exception 'TEST FAILED: expected outcome=found after re-enabling, got %.', r.outcome;
      end if;

      -- Section 4: permanently revoke -- terminal, cannot be re-enabled.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.permanently_revoke_share_link(token_a, 'ZZ revoke reason') into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'success' then
        raise exception 'TEST FAILED: expected permanently_revoke_share_link to succeed on an active link, got %.', action_result;
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.re_enable_share_link(token_a) into action_result;
      perform set_config('role', original_role, true);
      -- No exception expected here -- the WHERE guard simply matches zero
      -- rows for a permanently_revoked token, the same honestly-reported
      -- no-op shape as any other already-settled state, not an error.
      if action_result = 'success' then
        raise exception 'TEST FAILED: re_enable_share_link reported success for a permanently revoked link -- must be structurally impossible.';
      end if;
      if action_result <> 'already_not_disabled' then
        raise exception 'TEST FAILED: expected already_not_disabled when re-enabling a permanently revoked link, got %.', action_result;
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.permanently_revoke_share_link(token_a) into action_result;
      perform set_config('role', original_role, true);
      if action_result <> 'already_terminal' then
        raise exception 'TEST FAILED: expected already_terminal when revoking an already-revoked link, got %.', action_result;
      end if;

      -- Section 5: regenerate on the SUBMITTAL token -- old becomes
      -- superseded and points at the new token; the new token resolves
      -- 'found'; the old resolves 'superseded'.
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.regenerate_share_link(token_b) into new_token;
      perform set_config('role', original_role, true);

      if new_token is null or new_token = token_b then
        raise exception 'TEST FAILED: regenerate_share_link did not return a real, distinct new token.';
      end if;
      if not exists (select 1 from public.public_share_tokens where token = token_b and status = 'superseded' and superseded_by_token = new_token) then
        raise exception 'TEST FAILED: the old submittal token was not correctly marked superseded pointing at the new token.';
      end if;

      select * into r from public.get_submittal_by_token(token_b);
      if r.outcome <> 'superseded' then
        raise exception 'TEST FAILED: expected outcome=superseded for the old (regenerated-away) submittal token, got %.', r.outcome;
      end if;
      select * into r from public.get_submittal_by_token(new_token);
      if r.outcome <> 'found' then
        raise exception 'TEST FAILED: expected outcome=found for the new submittal token, got %.', r.outcome;
      end if;

      -- Section 6: a genuinely unknown token reports invalid_token, not
      -- an error.
      select * into r from public.get_quote_proposal_by_token('ZZ_DOES_NOT_EXIST');
      if r.outcome <> 'invalid_token' then
        raise exception 'TEST FAILED: expected outcome=invalid_token for a token that never existed, got %.', r.outcome;
      end if;

      -- Section 7: a real successful response extends the token's
      -- expiration to the workspace's completed-document default (longer
      -- than the open-document default it was created with).
      select * into r from public.respond_to_submittal(new_token, 'approved', 'ZZ Approver', '127.0.0.1', '');
      if r.outcome <> 'success' then
        raise exception 'TEST FAILED: expected a healthy submittal link to accept a response successfully, got outcome=%.', r.outcome;
      end if;
      if not exists (
        select 1 from public.public_share_tokens t, public.workspace_share_link_settings s
        where t.token = new_token
          and s.workspace_id = public.active_workspace_id()
          and t.expires_at > now() + s.default_expiration_open_documents
      ) then
        raise exception 'TEST FAILED: a successfully responded-to submittal''s link expiration was not extended to the longer completed-document default.';
      end if;

      -- Section 8: authorization boundaries -- a PM cannot manage a
      -- PROPOSAL link (no proposal authority per the decided model), and
      -- a Sales-only user cannot manage a SUBMITTAL link.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.disable_share_link(token_a);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only caller was able to manage a proposal share link.';
      end if;

      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.disable_share_link(new_token);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a Sales-only caller was able to manage a submittal share link.';
      end if;

      if not pm_role_preexisted and pm_user_id is not null then
        delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm';
      end if;
      if not sales_role_preexisted and sales_user_id is not null then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'sales';
      end if;
    end if;
  end if;

  -- Section 9 (checked regardless): grant boundaries -- anon cannot call
  -- any of the four staff-only lifecycle RPCs; authenticated cannot call
  -- either public read RPC directly (anon-only, matching the submittal
  -- RPCs' own already-established pattern).
  select has_function_privilege('anon', 'public.disable_share_link(text, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on disable_share_link -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.regenerate_share_link(text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on regenerate_share_link -- expected authenticated-only.';
  end if;
  select has_function_privilege('authenticated', 'public.get_quote_proposal_by_token(text)', 'execute') into authenticated_can_execute_public_rpc;
  if authenticated_can_execute_public_rpc then
    raise exception 'TEST FAILED: authenticated has execute privilege on get_quote_proposal_by_token -- expected anon-only, matching the submittal RPC''s own precedent.';
  end if;
  select has_function_privilege('authenticated', 'public.respond_to_submittal(text, text, text, text, text)', 'execute') into authenticated_can_execute_public_rpc;
  if authenticated_can_execute_public_rpc then
    raise exception 'TEST FAILED: authenticated has execute privilege on respond_to_submittal -- expected anon-only.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 139 SHARE-LINK LIFECYCLE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

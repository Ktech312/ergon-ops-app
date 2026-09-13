-- Transaction-safe, rollback-only tests for migration 137's INERT share-link
-- lifecycle schema. Wrapped in begin;/rollback; -- nothing here ever commits.
-- Proves the one thing this migration must guarantee above all else: it
-- changes NOTHING about existing token resolution or client-visible
-- behavior. Uses REAL, already-existing data where possible (never
-- fabricates a fake auth.users row); synthetic fixtures where a real
-- existing token/proposal/submittal can't be relied on to exist.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 137 SHARE-LINK SCHEMA
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming what
-- failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  non_admin_user_id uuid;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  existing_token_count integer;
  non_active_count integer;
  active_workspace_count integer;
  settings_row_count integer;

  real_proposal_token text;
  before_result record;
  after_result record;

  caught boolean;
  test_token text := 'ZZ_TEST_TOKEN_' || substr(md5(random()::text), 1, 16);
  test_token_2 text := 'ZZ_TEST_TOKEN_2_' || substr(md5(random()::text), 1, 16);
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  -- Section 1: every existing public_share_tokens row backfilled to
  -- status = 'active' -- never anything else, since nothing before this
  -- migration ever set a different lifecycle state.
  select count(*) into existing_token_count from public.public_share_tokens;
  select count(*) into non_active_count from public.public_share_tokens where status <> 'active';
  if existing_token_count = 0 then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'backfill-check (no existing public_share_tokens rows found)');
  elsif non_active_count <> 0 then
    raise exception 'TEST FAILED: % existing public_share_tokens row(s) are NOT status = ''active'' after backfill -- expected all existing rows to backfill to active.', non_active_count;
  end if;

  -- Section 2: exactly one workspace_share_link_settings row per active
  -- workspace -- proves the seed ran and is idempotent (on conflict do
  -- nothing), not zero rows and not duplicates.
  select count(*) into active_workspace_count from public.workspaces where status = 'active';
  select count(*) into settings_row_count from public.workspace_share_link_settings;
  if active_workspace_count = 0 then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'settings-seed-check (no active workspace found)');
  elsif settings_row_count <> active_workspace_count then
    raise exception 'TEST FAILED: % active workspace(s) but % workspace_share_link_settings row(s) -- expected exactly one settings row per active workspace.', active_workspace_count, settings_row_count;
  end if;

  -- Section 3: a REAL existing proposal link (if one exists) still
  -- resolves successfully via get_quote_proposal_by_token after this
  -- migration -- this function's own SQL body is untouched by migration
  -- 137 (it does not select the new `status` column at all), so a
  -- resolvable token still resolving, twice, identically, is the
  -- available proof within one script that nothing about its behavior
  -- broke. It is not a true before/after comparison (that would require
  -- running this script both before and after the migration in separate
  -- sessions) -- it is the strongest check obtainable from inside a
  -- single transaction-safe test.
  select t.token into real_proposal_token
  from public.public_share_tokens t
  where t.entity_type = 'sales_quote_proposal'
  limit 1;

  if real_proposal_token is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'rpc-unchanged-check (no real sales_quote_proposal share token found)');
  else
    select * into before_result from public.get_quote_proposal_by_token(real_proposal_token);
    select * into after_result from public.get_quote_proposal_by_token(real_proposal_token);
    if before_result.proposal_id is null then
      raise exception 'TEST FAILED: get_quote_proposal_by_token did not resolve a real, existing share token after this migration -- expected it to keep resolving exactly as before.';
    end if;
    if before_result.proposal_id is distinct from after_result.proposal_id
      or before_result.status is distinct from after_result.status
      or before_result.version is distinct from after_result.version
    then
      raise exception 'TEST FAILED: get_quote_proposal_by_token returned different results for the same real token across two calls -- expected deterministic, unchanged behavior.';
    end if;
  end if;

  -- Section 4: constraint rejections -- each of these must be REJECTED.
  caught := false;
  begin
    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (test_token, 'sales_quote_proposal', gen_random_uuid(), 'not_a_real_status');
  exception when check_violation then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an invalid public_share_tokens.status value was accepted -- the check constraint is missing or broken.';
  end if;

  caught := false;
  begin
    insert into public.share_link_actions (entity_type, entity_id, action)
      values ('sales_quote_proposal', gen_random_uuid(), 'not_a_real_action');
  exception when check_violation then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an invalid share_link_actions.action value was accepted -- the check constraint is missing or broken.';
  end if;

  caught := false;
  begin
    insert into public.share_link_views (entity_type, entity_id, result)
      values ('sales_quote_proposal', gen_random_uuid(), 'not_a_real_result');
  exception when check_violation then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an invalid share_link_views.result value was accepted -- the check constraint is missing or broken.';
  end if;

  -- Section 5: superseded_by_token self-reference actually enforces a
  -- real token -- a made-up value must be rejected as a foreign-key
  -- violation, proving the column is a real FK, not just a bare text
  -- field.
  insert into public.public_share_tokens (token, entity_type, entity_id)
    values (test_token, 'sales_quote_proposal', gen_random_uuid());
  caught := false;
  begin
    update public.public_share_tokens set superseded_by_token = 'ZZ_DOES_NOT_EXIST' where token = test_token;
  exception when foreign_key_violation then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: superseded_by_token accepted a value with no matching token row -- the self-referencing FK is missing or broken.';
  end if;
  -- A real self-reference (to a second real token row) must succeed.
  insert into public.public_share_tokens (token, entity_type, entity_id)
    values (test_token_2, 'sales_quote_proposal', gen_random_uuid());
  update public.public_share_tokens set superseded_by_token = test_token_2 where token = test_token;
  if not exists (select 1 from public.public_share_tokens where token = test_token and superseded_by_token = test_token_2) then
    raise exception 'TEST FAILED: a valid superseded_by_token self-reference did not persist.';
  end if;

  -- Section 6: grants and RLS -- minimum-access checks. anon must not be
  -- able to touch either new audit table or the settings table (none of
  -- the four public RPCs need to -- that capability is added, narrowly,
  -- in C2.3/C2.4 via security-definer functions, not direct anon table
  -- access).
  if has_table_privilege(
    'anon',
    'public.share_link_views',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) then
    raise exception 'TEST FAILED: anon has direct table privilege on share_link_views -- expected none.';
  end if;
  if has_table_privilege(
    'anon',
    'public.share_link_actions',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) then
    raise exception 'TEST FAILED: anon has direct table privilege on share_link_actions -- expected none.';
  end if;
  if has_table_privilege(
    'anon',
    'public.workspace_share_link_settings',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) then
    raise exception 'TEST FAILED: anon has direct table privilege on workspace_share_link_settings -- expected none.';
  end if;

  if not has_table_privilege('authenticated', 'public.share_link_views', 'SELECT')
    or has_table_privilege(
      'authenticated',
      'public.share_link_views',
      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    )
  then
    raise exception 'TEST FAILED: authenticated privileges on share_link_views are not SELECT-only.';
  end if;
  if not has_table_privilege('authenticated', 'public.share_link_actions', 'SELECT')
    or has_table_privilege(
      'authenticated',
      'public.share_link_actions',
      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    )
  then
    raise exception 'TEST FAILED: authenticated privileges on share_link_actions are not SELECT-only.';
  end if;
  if not has_table_privilege('authenticated', 'public.workspace_share_link_settings', 'SELECT')
    or not has_table_privilege('authenticated', 'public.workspace_share_link_settings', 'INSERT')
    or not has_table_privilege('authenticated', 'public.workspace_share_link_settings', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.workspace_share_link_settings', 'DELETE')
    or has_table_privilege(
      'authenticated',
      'public.workspace_share_link_settings',
      'TRUNCATE, REFERENCES, TRIGGER'
    )
  then
    raise exception 'TEST FAILED: authenticated privileges on workspace_share_link_settings are incorrect.';
  end if;

  -- Section 7: a non-admin authenticated user can read
  -- workspace_share_link_settings but cannot write it (admin-only write,
  -- matching company_branding's own established precedent).
  select wm.user_id into non_admin_user_id
    from public.workspace_members wm
    where wm.user_id not in (select user_id from public.app_admins)
    limit 1;

  if non_admin_user_id is null or active_workspace_count = 0 then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'non-admin-settings-write-denied (no non-admin workspace member or no active workspace found)');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    update public.workspace_share_link_settings
      set default_expiration_open_documents = interval '1 day'
      where workspace_id = (select id from public.workspaces where status = 'active' limit 1);
    get diagnostics existing_token_count = row_count;

    perform set_config('role', original_role, true);

    if existing_token_count <> 0 then
      raise exception 'TEST FAILED: a non-admin authenticated user was able to write workspace_share_link_settings -- expected admin-only write to be enforced.';
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 137 SHARE-LINK SCHEMA TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

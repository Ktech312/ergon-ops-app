-- Transaction-safe canonical test for migration 207 (notification_event_types
-- lookup table + shared provision_default_notification_rules(), closing the
-- "brand-new workspace has zero notification_rules rows" gap). Wrapped in
-- begin;/rollback; -- nothing here ever commits. Fully synthetic workspaces
-- and users (ZZ Test 207 prefix) so this never depends on, or disturbs, any
-- real production data.
--
-- Covers, matching this migration's own acceptance criteria one for one:
-- (a) every single event type in notification_event_types gets a real
--     notification_rules row when provision_default_notification_rules()
--     is called for a fresh workspace with zero existing rows -- an exact
--     count AND a real per-type anti-join, not just "some rows exist".
-- (b) calling it again against a workspace that already has rows, some of
--     them CUSTOMIZED (non-default channels/is_active) and one genuinely
--     MISSING, only fills in the missing one -- the customized row's
--     values are left completely untouched.
-- (c) approve_company_signup()'s own real, end-to-end flow (submit ->
--     approve -> accept) results in a brand-new company workspace having
--     every valid notification rule provisioned, and that the rest of the
--     195/196 signup/accept behavior still works after this migration's
--     one new call was inserted into it.
-- (d) adding a NEW row to notification_event_types (simulating a future
--     event type this schema doesn't have yet) and re-running the
--     provisioning function against an EXISTING workspace picks it up
--     automatically -- empirical proof, not just an architecture claim.
-- (e) the new FK (replacing the old CHECK constraint) actually rejects an
--     event_type with no matching notification_event_types row.
-- (f) the new dedicated guard trigger (guard_notification_rules_workspace_
--     id_mutation) still fail-closes a normal, non-provisioning insert
--     exactly like the original shared guard_workspace_id_mutation() did
--     -- a caller-supplied workspace_id is silently replaced with the
--     caller's own real workspace, never honored, when the
--     app.provisioning_workspace_id escape hatch is not set.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 207 NOTIFICATION EVENT
-- TYPES AND AUTO PROVISIONING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  admin_id uuid := gen_random_uuid();
  prospect_id uuid := gen_random_uuid();
  prospect_email text := 'zz-test-207-prospect@example.com';
  ws_a_id uuid;
  event_type_count integer;
  rule_count integer;
  row_count integer;
  channels_val text[];
  active_val boolean;
  request_id uuid;
  approval_result jsonb;
  new_workspace_id uuid;
  issued_token uuid;
  outcome_text text;
  outcome_workspace_id uuid;
  caught boolean;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  select count(*) into event_type_count from public.notification_event_types;
  if event_type_count <> 16 then
    raise exception 'TEST SETUP FAILED: notification_event_types has % rows, expected exactly 16 before this test''s own Section (d) adds a 17th', event_type_count;
  end if;

  insert into public.workspaces (name, slug, status) values ('ZZ Test 207 Workspace A', 'zz-test-207-ws-a', 'active') returning id into ws_a_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_id, 'zz-test-207-admin@example.com', now()),
    (prospect_id, prospect_email, now());

  insert into public.platform_admins (user_id) values (admin_id);

  -- ============================================================
  -- Section (a): a fresh workspace with zero notification_rules rows
  -- gets EXACTLY one row per notification_event_types row.
  -- ============================================================

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id;
  if rule_count <> 0 then
    raise exception 'TEST SETUP FAILED: ws_a already has % notification_rules rows before provisioning ran', rule_count;
  end if;

  perform public.provision_default_notification_rules(ws_a_id);

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id;
  if rule_count <> 16 then
    raise exception 'TEST FAILED: provision_default_notification_rules gave ws_a % rows, expected exactly 16 (one per notification_event_types row)', rule_count;
  end if;

  -- A real per-type anti-join -- proves every event type individually has
  -- a row, not just that the totals happen to match.
  select count(*) into row_count
  from public.notification_event_types et
  where not exists (
    select 1 from public.notification_rules nr
    where nr.workspace_id = ws_a_id and nr.event_type = et.event_type
  );
  if row_count <> 0 then
    raise exception 'TEST FAILED: % event type(s) in notification_event_types have NO matching notification_rules row for ws_a', row_count;
  end if;

  raise notice 'TEST PASSED: Section (a) -- a fresh workspace gets exactly one notification_rules row per notification_event_types row, every event type individually covered';

  -- ============================================================
  -- Section (b): re-running against a workspace with some CUSTOMIZED
  -- rows and one genuinely MISSING row only fills in the missing one --
  -- the customized row's values are left completely untouched.
  -- ============================================================

  update public.notification_rules
  set channels = '{email}', is_active = false
  where workspace_id = ws_a_id and event_type = 'task_assigned';

  delete from public.notification_rules where workspace_id = ws_a_id and event_type = 'low_stock_reached';

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id;
  if rule_count <> 15 then
    raise exception 'TEST SETUP FAILED: expected 15 rows for ws_a after deleting its low_stock_reached row, got %', rule_count;
  end if;

  perform public.provision_default_notification_rules(ws_a_id);

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id;
  if rule_count <> 16 then
    raise exception 'TEST FAILED: re-provisioning did not refill the missing low_stock_reached row (% rows, expected 16)', rule_count;
  end if;

  select channels, is_active into channels_val, active_val
  from public.notification_rules where workspace_id = ws_a_id and event_type = 'task_assigned';
  if channels_val <> '{email}'::text[] or active_val <> false then
    raise exception 'TEST FAILED: re-provisioning overwrote a customized row (task_assigned: channels=%, is_active=%; expected {email}/false)', channels_val, active_val;
  end if;

  select channels, is_active into channels_val, active_val
  from public.notification_rules where workspace_id = ws_a_id and event_type = 'low_stock_reached';
  if channels_val <> '{in_app}'::text[] or active_val <> false then
    raise exception 'TEST FAILED: the refilled low_stock_reached row does not match notification_event_types'' own default (channels=%, is_active=%; expected {in_app}/false)', channels_val, active_val;
  end if;

  raise notice 'TEST PASSED: Section (b) -- re-provisioning fills in only genuinely missing event types and never overwrites an existing customized row';

  -- ============================================================
  -- Section (c): approve_company_signup's real, end-to-end flow
  -- provisions every valid notification rule for a brand-new company --
  -- not the provisioning function tested in isolation -- and the rest of
  -- migration 195/196's own signup/accept behavior still works with this
  -- migration's one new call inserted into it.
  -- ============================================================

  select public.submit_company_signup_request('ZZ Test 207 Co', 'Prospect Person', prospect_email) into request_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.approve_company_signup(request_id) into approval_result;
  new_workspace_id := (approval_result->>'workspace_id')::uuid;
  issued_token := (approval_result->>'signup_token')::uuid;

  perform set_config('role', 'postgres', true);

  select count(*) into rule_count from public.notification_rules where workspace_id = new_workspace_id;
  if rule_count <> 16 then
    raise exception 'TEST FAILED: approve_company_signup left % notification_rules rows for the new workspace, expected exactly 16', rule_count;
  end if;

  select count(*) into row_count
  from public.notification_event_types et
  where not exists (
    select 1 from public.notification_rules nr
    where nr.workspace_id = new_workspace_id and nr.event_type = et.event_type
  );
  if row_count <> 0 then
    raise exception 'TEST FAILED: % event type(s) missing a notification_rules row for the newly-approved company', row_count;
  end if;

  -- Re-verify the rest of the real flow still works end to end.
  perform set_config('request.jwt.claims', json_build_object('sub', prospect_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(issued_token);
  if outcome_text is distinct from 'accepted' or outcome_workspace_id is distinct from new_workspace_id then
    raise exception 'TEST FAILED: accept_company_signup did not succeed after this migration''s change (outcome=%, workspace_id=%)', outcome_text, outcome_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where user_id = prospect_id and workspace_id = new_workspace_id and is_workspace_admin = true;
  if row_count <> 1 then
    raise exception 'TEST FAILED: accept_company_signup did not create the founding workspace-admin membership row (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- approve_company_signup''s real end-to-end flow provisions all 16 notification rules for a brand-new company, and the rest of the signup/accept flow still works';

  -- ============================================================
  -- Section (d): adding a NEW row to notification_event_types
  -- (simulating a future event type) and re-running the provisioning
  -- function against an EXISTING workspace picks it up automatically --
  -- no code change required. Empirical proof, not an architecture claim.
  -- ============================================================

  insert into public.notification_event_types (event_type, default_channels, default_is_active)
  values ('zz_test_207_future_event', '{in_app}', true);

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id and event_type = 'zz_test_207_future_event';
  if rule_count <> 0 then
    raise exception 'TEST SETUP FAILED: ws_a already has a zz_test_207_future_event row before provisioning was ever asked to seed it';
  end if;

  perform public.provision_default_notification_rules(ws_a_id);

  select count(*) into rule_count from public.notification_rules where workspace_id = ws_a_id;
  if rule_count <> 17 then
    raise exception 'TEST FAILED: adding a new notification_event_types row did not result in a 17th notification_rules row for ws_a (got %)', rule_count;
  end if;

  select channels, is_active into channels_val, active_val
  from public.notification_rules where workspace_id = ws_a_id and event_type = 'zz_test_207_future_event';
  if channels_val <> '{in_app}'::text[] or active_val <> true then
    raise exception 'TEST FAILED: the auto-provisioned future event type row has the wrong defaults (channels=%, is_active=%)', channels_val, active_val;
  end if;

  raise notice 'TEST PASSED: Section (d) -- adding a new notification_event_types row and re-running provisioning against an existing workspace picks it up automatically, with no code change';

  -- ============================================================
  -- Section (e): the FK replacing the old CHECK constraint actually
  -- rejects an invalid event_type (regression-proofing the Step 2
  -- decision empirically, not just asserting the constraint exists).
  -- ============================================================

  caught := false;
  begin
    insert into public.notification_rules (workspace_id, event_type, channels, is_active)
    values (ws_a_id, 'zz_test_207_not_a_real_event_type', '{in_app}', true);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: notification_rules accepted an event_type with no matching notification_event_types row -- the FK is not actually enforced';
  end if;

  raise notice 'TEST PASSED: Section (e) -- the FK constraint rejects an event_type not present in notification_event_types';

  -- ============================================================
  -- Section (f): the new dedicated guard trigger still fail-closes a
  -- normal, non-provisioning insert exactly like the original shared
  -- guard_workspace_id_mutation() did -- proves the escape hatch did not
  -- weaken the pre-existing spoofing protection for real end-user writes.
  -- ============================================================

  declare
    guard_test_user_id uuid := gen_random_uuid();
    other_ws_id uuid;
  begin
    insert into auth.users (id, email, email_confirmed_at) values (guard_test_user_id, 'zz-test-207-guard@example.com', now());
    insert into public.workspaces (name, slug, status) values ('ZZ Test 207 Spoof Target', 'zz-test-207-ws-spoof', 'active') returning id into other_ws_id;
    insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_a_id, guard_test_user_id, false);
    insert into public.app_admins (user_id) values (guard_test_user_id) on conflict do nothing;

    perform set_config('request.jwt.claims', json_build_object('sub', guard_test_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    -- No app.provisioning_workspace_id set here -- this is the ordinary,
    -- non-provisioning write path. task_overdue already has a row for
    -- ws_a from earlier sections; remove it first so the assertion below
    -- is unambiguous.
    delete from public.notification_rules where workspace_id = ws_a_id and event_type = 'task_overdue';

    insert into public.notification_rules (workspace_id, event_type, channels, is_active)
    values (other_ws_id, 'task_overdue', '{in_app}', true);

    perform set_config('role', 'postgres', true);

    select count(*) into row_count from public.notification_rules where workspace_id = other_ws_id and event_type = 'task_overdue';
    if row_count <> 0 then
      raise exception 'TEST FAILED: a caller-supplied workspace_id was honored -- % row(s) landed in the spoofed target workspace instead of being overwritten', row_count;
    end if;

    select count(*) into row_count from public.notification_rules where workspace_id = ws_a_id and event_type = 'task_overdue';
    if row_count <> 1 then
      raise exception 'TEST FAILED: the insert did not land in the caller''s own real, resolved workspace as expected (% rows in ws_a)', row_count;
    end if;
  end;

  raise notice 'TEST PASSED: Section (f) -- the new dedicated guard trigger still fail-closes a normal insert exactly like the original shared trigger did';

  raise notice 'ALL MIGRATION 207 NOTIFICATION EVENT TYPES AND AUTO PROVISIONING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

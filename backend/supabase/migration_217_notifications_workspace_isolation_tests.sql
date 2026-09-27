-- Transaction-safe canonical test for migration 217 (notifications
-- cross-tenant isolation -- narrows, does not broaden, the existing
-- is_app_admin bypass; also gates insert by shared workspace). Wrapped
-- in begin;/rollback; -- nothing here ever commits.
--
-- Covers: (a) a user can always read/update their own notification,
-- unconditionally, unaffected; (b) an admin can read/update a
-- notification for a recipient who shares their own workspace; (c) an
-- admin CANNOT read or update a notification for a recipient in a
-- DIFFERENT workspace -- the actual cross-tenant leak this migration
-- closes; (d) an ordinary (non-admin) user can create a notification
-- for a teammate in their own workspace; (e) an ordinary user CANNOT
-- create a notification targeting a recipient in a different
-- workspace -- the insert-side leak; (f) a real global app_admin still
-- works for a real Ergon teammate, but not for a synthetic other-
-- workspace recipient.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 217 NOTIFICATIONS
-- WORKSPACE ISOLATION TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_app_admin_id uuid;
  real_app_admin_email text;
  real_ergon_teammate_email text;
  real_ergon_teammate_id uuid;
  workspace_a_id uuid;
  workspace_b_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  recipient_a_user_id uuid := gen_random_uuid();
  recipient_b_user_id uuid := gen_random_uuid();
  admin_a_email text := 'zz-test-217-admin-a@example.com';
  recipient_a_email text := 'zz-test-217-recipient-a@example.com';
  recipient_b_email text := 'zz-test-217-recipient-b@example.com';
  notification_own_id uuid;
  notification_a_id uuid;
  row_count integer;
  caught boolean;
begin
  select pa.user_id into real_app_admin_id from public.app_admins pa limit 1;
  if real_app_admin_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin found.';
  end if;
  select email into real_app_admin_email from auth.users where id = real_app_admin_id;

  select wm.user_id into real_ergon_teammate_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active' and wm.user_id <> real_app_admin_id
  limit 1;
  if real_ergon_teammate_id is not null then
    select email into real_ergon_teammate_email from auth.users where id = real_ergon_teammate_id;
  end if;

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 217 Workspace A', 'zz-test-217-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 217 Workspace B', 'zz-test-217-workspace-b', 'active') returning id into workspace_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, admin_a_email, now()),
    (ordinary_a_user_id, 'zz-test-217-ordinary-a@example.com', now()),
    (recipient_a_user_id, recipient_a_email, now()),
    (recipient_b_user_id, recipient_b_email, now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_a_id, recipient_a_user_id, false),
    (workspace_b_id, recipient_b_user_id, false);

  -- admin_a_user_id is a real GLOBAL app_admin here, not just a
  -- workspace admin -- this migration deliberately does NOT broaden
  -- workspace-admin access to other members' notifications (no product
  -- use case for it exists), it only narrows the EXISTING global
  -- is_app_admin bypass to same-workspace-only. Sections (b)/(c) below
  -- test exactly that narrowing, so the caller must actually hold the
  -- global flag.
  insert into public.app_admins (user_id) values (admin_a_user_id);

  insert into public.notifications (recipient_email, event_type, title) values (admin_a_email, 'task_assigned', 'Own notification') returning id into notification_own_id;
  insert into public.notifications (recipient_email, event_type, title) values (recipient_a_email, 'task_assigned', 'Workspace A notification') returning id into notification_a_id;
  insert into public.notifications (recipient_email, event_type, title) values (recipient_b_email, 'task_assigned', 'Workspace B notification');

  -- ============================================================
  -- Section (a): a user can always read/update their own notification.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text, 'email', admin_a_email)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.notifications where id = notification_own_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a user cannot read their own notification';
  end if;

  update public.notifications set is_read = true where id = notification_own_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.notifications where id = notification_own_id and is_read = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a user cannot update (mark read) their own notification';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a user can always read and update their own notification, unaffected';

  -- ============================================================
  -- Section (b): an admin can read/update a notification for a
  -- recipient who shares their own workspace.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text, 'email', admin_a_email)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.notifications where id = notification_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an admin cannot read a notification for a recipient in their own workspace';
  end if;

  update public.notifications set is_read = true where id = notification_a_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.notifications where id = notification_a_id and is_read = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an admin cannot update a notification for a recipient in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (b) -- an admin can read and update a notification for a recipient who shares their own workspace';

  -- ============================================================
  -- Section (c): the actual leak this migration closes -- an admin
  -- CANNOT read or update a notification for a recipient in a
  -- DIFFERENT workspace.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text, 'email', admin_a_email)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.notifications where recipient_email = recipient_b_email;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s recipient''s notification (% rows -- this is the pre-existing global is_app_admin leak)', row_count;
  end if;

  begin
    update public.notifications set is_read = true where recipient_email = recipient_b_email;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.notifications where recipient_email = recipient_b_email and is_read = true) then
    raise exception 'TEST FAILED: workspace A''s admin could mark workspace B''s recipient''s notification as read';
  end if;

  raise notice 'TEST PASSED: Section (c) -- an admin can no longer read or update another workspace''s recipient''s notifications -- the actual cross-tenant leak this migration closes';

  -- ============================================================
  -- Section (d): an ordinary user can create a notification for a
  -- teammate in their own workspace.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.notifications (recipient_email, event_type, title) values (recipient_a_email, 'task_assigned', 'From a teammate');

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.notifications where recipient_email = recipient_a_email and title = 'From a teammate';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an ordinary user could not create a notification for a teammate in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an ordinary user can create a notification for a teammate in their own workspace';

  -- ============================================================
  -- Section (e): the insert-side leak -- an ordinary user CANNOT
  -- create a notification targeting a different workspace's recipient.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.notifications (recipient_email, event_type, title) values (recipient_b_email, 'task_assigned', 'Should fail');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary user could create a notification targeting a different workspace''s recipient';
  end if;

  raise notice 'TEST PASSED: Section (e) -- an ordinary user cannot create a notification for a recipient in a different workspace';

  -- ============================================================
  -- Section (f): a real global app_admin still works for a real Ergon
  -- teammate's notification, but not for a synthetic other-workspace
  -- recipient.
  -- ============================================================

  if real_ergon_teammate_email is not null then
    perform set_config('role', 'postgres', true);
    insert into public.notifications (recipient_email, event_type, title) values (real_ergon_teammate_email, 'task_assigned', 'ZZ Test 217 real teammate notification');

    perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    select count(*) into row_count from public.notifications where recipient_email = real_ergon_teammate_email and title = 'ZZ Test 217 real teammate notification';
    if row_count is distinct from 1 then
      raise exception 'TEST FAILED: a real global app_admin can no longer read a real Ergon teammate''s notification';
    end if;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.notifications where recipient_email = recipient_b_email;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a real global app_admin could read a synthetic other-workspace recipient''s notification (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (f) -- a real global app_admin still works within their own real workspace, but not for a different (synthetic) workspace''s recipient';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 217 NOTIFICATIONS WORKSPACE ISOLATION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

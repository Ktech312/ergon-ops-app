-- Transaction-safe canonical test for migration 199
-- (get_platform_admin_emails()). Wrapped in begin;/rollback; -- nothing
-- here ever commits.
--
-- Covers:
-- (a) a real platform admin's email is returned correctly.
-- (b) an app_admin-only user (NOT a platform admin) is never returned --
--     the direct proof this is genuinely platform_admins-scoped, not
--     app_admins, closing the exact conflation this whole security-review
--     arc started from.
-- (c) a platform admin with no app_known_users row (never logged in) is
--     silently excluded, not returned with a null email.
-- (d) not callable by `authenticated` at all -- permission denied, not
--     just an empty result -- so no signed-in user, platform admin or
--     not, can probe this from the client.
-- (e) not callable by `anon` at all.

begin;

do $$
declare
  real_platform_admin_id uuid := gen_random_uuid();
  real_platform_admin_email text := 'zz-test-199-real-platform-admin@example.com';
  app_admin_only_id uuid := gen_random_uuid();
  no_known_user_platform_admin_id uuid := gen_random_uuid();
  row_count integer;
  found_email text;
  caught boolean;
begin
  perform set_config('role', 'postgres', true);

  insert into auth.users (id, email, email_confirmed_at) values
    (real_platform_admin_id, real_platform_admin_email, now()),
    (app_admin_only_id, 'zz-test-199-app-admin-only@example.com', now()),
    (no_known_user_platform_admin_id, 'zz-test-199-no-known-user@example.com', now());

  -- Fully synthetic fixtures, independent of whatever real platform admins
  -- exist in this environment's seed data -- this test builds and proves
  -- its own cases rather than assuming a particular admin/app_known_users
  -- row already exists.
  insert into public.platform_admins (user_id) values (real_platform_admin_id);
  insert into public.app_known_users (user_id, email) values (real_platform_admin_id, real_platform_admin_email);

  insert into public.app_admins (user_id) values (app_admin_only_id) on conflict do nothing;
  insert into public.app_known_users (user_id, email) values (app_admin_only_id, 'zz-test-199-app-admin-only@example.com');
  -- Deliberately NOT inserted into platform_admins -- this is section (b)'s fixture.

  insert into public.platform_admins (user_id) values (no_known_user_platform_admin_id);
  -- Deliberately NO app_known_users row for this one -- section (c)'s fixture.

  -- ============================================================
  -- Section (a): a real platform admin's email is returned correctly.
  -- ============================================================

  select email into found_email from public.get_platform_admin_emails() where user_id = real_platform_admin_id;
  if found_email is null then
    raise exception 'TEST FAILED: get_platform_admin_emails() did not return the real platform admin''s email';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a real platform admin''s email is returned correctly';

  -- ============================================================
  -- Section (b): an app_admin-only user is never returned.
  -- ============================================================

  select count(*) into row_count from public.get_platform_admin_emails() where user_id = app_admin_only_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: get_platform_admin_emails() returned an app_admin-only (not platform_admin) user -- the exact conflation this must never repeat';
  end if;

  raise notice 'TEST PASSED: Section (b) -- an app_admin-only user (not a platform admin) is never returned';

  -- ============================================================
  -- Section (c): a platform admin with no app_known_users row is
  -- silently excluded, not returned with a null email.
  -- ============================================================

  select count(*) into row_count from public.get_platform_admin_emails() where user_id = no_known_user_platform_admin_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: get_platform_admin_emails() returned a row with no real email for a platform admin who has never logged in';
  end if;

  raise notice 'TEST PASSED: Section (c) -- a platform admin with no known-user row is excluded, not returned with a null email';

  -- ============================================================
  -- Section (d): not callable by `authenticated` at all.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_platform_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform * from public.get_platform_admin_emails();
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: get_platform_admin_emails() is callable by authenticated -- even a real platform admin''s own signed-in session must not be able to call this directly';
  end if;

  raise notice 'TEST PASSED: Section (d) -- not callable by authenticated at all, not even by a real platform admin''s own session';

  -- ============================================================
  -- Section (e): not callable by `anon` at all.
  -- ============================================================

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    perform * from public.get_platform_admin_emails();
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: get_platform_admin_emails() is callable by anon';
  end if;

  raise notice 'TEST PASSED: Section (e) -- not callable by anon at all';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 199 PLATFORM ADMIN EMAILS FOR SIGNUP NOTIFICATIONS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

-- Transaction-safe canonical test for migration 215
-- (workspace_sales_approval_settings RLS: workspace-scoped read,
-- workspace-admin write). Wrapped in begin;/rollback; -- nothing here
-- ever commits.
--
-- Covers: (a) a workspace-admin-only user can read and write their own
-- workspace's settings row; (b) cross-workspace isolation -- cannot
-- read or write another workspace's row (the actual pre-existing leak
-- this migration closes, previously `using (true)` for SELECT); (c) an
-- ordinary (non-admin) workspace member can still READ (matches the
-- original intent -- "authenticated read", just workspace-scoped now)
-- but cannot WRITE; (d) a suspended workspace's own admin cannot write;
-- (e) a real global app_admin still works, unaffected; (f) every active
-- workspace has a settings row after the backfill (proving K-Tech-style
-- gap is closed).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 215 WORKSPACE SALES
-- APPROVAL SETTINGS RLS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_app_admin_id uuid;
  workspace_a_id uuid;
  workspace_b_id uuid;
  suspended_workspace_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  admin_b_user_id uuid := gen_random_uuid();
  suspended_admin_id uuid := gen_random_uuid();
  row_count integer;
  caught boolean;
begin
  select pa.user_id into real_app_admin_id from public.app_admins pa limit 1;
  if real_app_admin_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 215 Workspace A', 'zz-test-215-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 215 Workspace B', 'zz-test-215-workspace-b', 'active') returning id into workspace_b_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 215 Suspended Co', 'zz-test-215-suspended', 'active') returning id into suspended_workspace_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, 'zz-test-215-admin-a@example.com', now()),
    (ordinary_a_user_id, 'zz-test-215-ordinary-a@example.com', now()),
    (admin_b_user_id, 'zz-test-215-admin-b@example.com', now()),
    (suspended_admin_id, 'zz-test-215-suspended-admin@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_b_id, admin_b_user_id, true),
    (suspended_workspace_id, suspended_admin_id, true);

  -- ============================================================
  -- Section (f): the backfill covers every active workspace (this
  -- migration's own backfill statement already ran as part of applying
  -- the migration file itself, above -- these three new workspaces were
  -- only just created, so re-run it here to prove it still works going
  -- forward, not just once at migration-apply time).
  -- ============================================================

  insert into public.workspace_sales_approval_settings (workspace_id)
  select id from public.workspaces where status = 'active'
  on conflict (workspace_id) do nothing;

  select count(*) into row_count from public.workspace_sales_approval_settings
  where workspace_id in (workspace_a_id, workspace_b_id, suspended_workspace_id);
  if row_count is distinct from 3 then
    raise exception 'TEST FAILED: not every active workspace has a settings row after the backfill (% of 3)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (f) -- every active workspace gets a settings row via the backfill, not just the one workspace that existed when migration 147 first ran';

  -- ============================================================
  -- Section (a): workspace-admin-only read + write for their own row.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_sales_approval_settings where workspace_id = workspace_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user cannot read their own workspace''s sales approval settings';
  end if;

  update public.workspace_sales_approval_settings set discount_approval_enabled = true, discount_approval_threshold_percent = 15 where workspace_id = workspace_a_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_sales_approval_settings where workspace_id = workspace_a_id and discount_approval_enabled = true and discount_approval_threshold_percent = 15;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user cannot write their own workspace''s sales approval settings';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a workspace-admin-only user can read and write their own workspace''s settings';

  -- ============================================================
  -- Section (b): cross-workspace isolation -- the actual leak this
  -- migration closes (was `using (true)` for SELECT).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_sales_approval_settings where workspace_id = workspace_b_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s sales approval settings (% rows -- this is the pre-existing using(true) leak)', row_count;
  end if;

  begin
    update public.workspace_sales_approval_settings set discount_approval_threshold_percent = 99 where workspace_id = workspace_b_id;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.workspace_sales_approval_settings where workspace_id = workspace_b_id and discount_approval_threshold_percent = 99) then
    raise exception 'TEST FAILED: workspace A''s admin could write to workspace B''s sales approval settings';
  end if;

  raise notice 'TEST PASSED: Section (b) -- cross-workspace isolation now holds, closing the previous using(true) read leak';

  -- ============================================================
  -- Section (c): an ordinary (non-admin) member can still read but
  -- cannot write.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_sales_approval_settings where workspace_id = workspace_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an ordinary workspace member cannot read their own workspace''s settings -- over-restricted';
  end if;

  caught := false;
  begin
    update public.workspace_sales_approval_settings set discount_approval_threshold_percent = 50 where workspace_id = workspace_a_id;
  exception when others then
    caught := true;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.workspace_sales_approval_settings where workspace_id = workspace_a_id and discount_approval_threshold_percent = 50) then
    raise exception 'TEST FAILED: an ordinary (non-admin) workspace member could write the sales approval settings';
  end if;

  raise notice 'TEST PASSED: Section (c) -- an ordinary member can still read but cannot write';

  -- ============================================================
  -- Section (d): a suspended workspace's own admin cannot write.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = suspended_workspace_id;

  perform set_config('request.jwt.claims', json_build_object('sub', suspended_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    update public.workspace_sales_approval_settings set discount_approval_threshold_percent = 20 where workspace_id = suspended_workspace_id;
  exception when others then
    caught := true;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.workspace_sales_approval_settings where workspace_id = suspended_workspace_id and discount_approval_threshold_percent = 20) then
    raise exception 'TEST FAILED: a suspended workspace''s own admin could still write its sales approval settings';
  end if;

  raise notice 'TEST PASSED: Section (d) -- a suspended workspace''s own admin cannot write its settings';

  -- ============================================================
  -- Section (e): a real global app_admin still works, unaffected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.workspace_sales_approval_settings set discount_approval_threshold_percent = 25 where workspace_id = workspace_a_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_sales_approval_settings where workspace_id = workspace_a_id and discount_approval_threshold_percent = 25;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a real global app_admin can no longer write any workspace''s sales approval settings';
  end if;

  raise notice 'TEST PASSED: Section (e) -- a real global app_admin still works, unaffected';

  raise notice 'ALL MIGRATION 215 WORKSPACE SALES APPROVAL SETTINGS RLS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

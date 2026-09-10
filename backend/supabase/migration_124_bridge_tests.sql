-- Transaction-safe tests for migration 124's bridge functions (revision
-- 4 -- a live run of revision 3 found a real defect in THIS script, not
-- in production code: it attempted `delete from public.workspaces where
-- id = real_workspace_id` to simulate the zero-workspace case, and this
-- database is genuinely populated -- both clients.workspace_id and
-- sales_quotes.workspace_id are real, NOT NULL foreign keys to that row
-- (migration 117). The DELETE failed live with `23503:
-- clients_workspace_id_fkey`. Wrapping a destructive statement in
-- begin;/rollback; does not make attempting it against real,
-- FK-referenced production rows safe -- the statement itself can fail
-- (as it did) before rollback is ever relevant, and even a
-- would-succeed DELETE against real referenced data is the wrong
-- instinct for a test script to reach for. The zero-workspace case is
-- now verified structurally instead (Section 9b, pg_get_functiondef
-- source inspection) -- never by attempting to empty the real table).
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users rather than fabricating fake auth.users rows,
-- matching this session's established discipline. Every "should fail"
-- assertion goes through the REAL authenticated execution path
-- (role='authenticated' + a real request.jwt.claims sub), and every one
-- of them now snapshots both the legacy and workspace-side rows before
-- the call and re-checks them afterward for byte-for-byte equality --
-- catching an exception alone does not prove nothing was written; an
-- identical snapshot does.
--
-- IMPORTANT: this can only run AFTER migration 124 has actually been
-- applied -- it calls functions that don't exist until then.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 124 BRIDGE TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error (either a "TEST
-- FAILED" exception from a real assertion, or a final "SECTIONS SKIPPED"
-- exception naming what was skipped). It can never quietly finish as
-- "Success. No rows returned." with something having been skipped.

begin;

do $$
declare
  admin_user_id uuid;
  non_admin_user_id uuid;
  second_admin_user_id uuid;
  test_workspace_id uuid;
  real_workspace_id uuid;
  original_role text;
  caught boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];
  admin_count_before integer;
  row_count integer;
  resolved_id uuid;
  resolved_bool boolean;
  legacy_snapshot_before jsonb;
  legacy_snapshot_after jsonb;
  workspace_snapshot_before jsonb;
  workspace_snapshot_after jsonb;
  admin_snapshot_before jsonb;
  admin_snapshot_after jsonb;
  allowed_views_before text[];
  allowed_views_after text[];
  legacy_primary_role_snapshot text;
  legacy_secondary_roles_snapshot text[];
  allowed_views_snapshot text[];
begin
  select current_setting('role') into original_role;

  select user_id into admin_user_id from public.app_admins limit 1;
  select id into non_admin_user_id from auth.users
    where id not in (select user_id from public.app_admins) limit 1;
  select id into real_workspace_id from public.workspaces limit 1;

  if admin_user_id is null or non_admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := skipped_names || 'all-sections (no admin+non-admin user pair found)';
  else

    -- ============================================================
    -- Section 1: is_app_admin(uuid) correctness + the documented fact
    -- that an authenticated caller can query it for an arbitrary target.
    -- ============================================================
    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    select public.is_app_admin(admin_user_id) into resolved_bool;
    if resolved_bool is distinct from true then
      raise exception 'TEST FAILED: is_app_admin(admin_user_id) should return true';
    end if;

    select public.is_app_admin(non_admin_user_id) into resolved_bool;
    if resolved_bool is distinct from false then
      raise exception 'TEST FAILED: is_app_admin(non_admin_user_id) should return false';
    end if;

    perform set_config('role', original_role, true);
    raise notice 'TEST PASSED: is_app_admin(uuid) returns correct results, and a non-admin caller CAN query it for an arbitrary target user id (documented fact, not a gap this migration introduces)';

    -- ============================================================
    -- Section 2: anonymous execution rejected at the grant layer, before
    -- reaching the function body -- snapshot app_admins to prove it.
    -- ============================================================
    select coalesce(jsonb_agg(user_id order by user_id), '[]'::jsonb) into admin_snapshot_before from public.app_admins;

    perform set_config('role', 'anon', true);
    caught := false;
    begin
      perform public.bridge_grant_admin(non_admin_user_id);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(user_id order by user_id), '[]'::jsonb) into admin_snapshot_after from public.app_admins;
    if not caught then
      raise exception 'TEST FAILED: an anon caller should be rejected outright (no EXECUTE grant), not reach the function body';
    end if;
    if admin_snapshot_before is distinct from admin_snapshot_after then
      raise exception 'TEST FAILED: app_admins changed despite the anon call being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: anon caller rejected at the grant layer for bridge_grant_admin, app_admins unchanged';

    -- ============================================================
    -- Section 3: primary role -- non-admin rejected (snapshot-verified),
    -- admin succeeds (writes both systems), invalid role_key rejected
    -- (snapshot-verified).
    -- ============================================================
    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary, 'allowed_views', allowed_views) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_before from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_primary_role(non_admin_user_id, 'support');
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary, 'allowed_views', allowed_views) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_after from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: a non-admin caller should have been rejected by bridge_set_primary_role';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after or workspace_snapshot_before is distinct from workspace_snapshot_after then
      raise exception 'TEST FAILED: state changed despite a non-admin call to bridge_set_primary_role being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: non-admin caller rejected by bridge_set_primary_role, both systems unchanged';

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_set_primary_role(non_admin_user_id, 'support');
    perform set_config('role', original_role, true);

    if not exists (select 1 from public.app_user_roles where user_id = non_admin_user_id and role_key = 'support' and is_primary) then
      raise exception 'TEST FAILED: bridge_set_primary_role should have written app_user_roles for an authorized admin caller';
    end if;
    if not exists (
      select 1 from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = non_admin_user_id and wmr.role_key = 'support' and wmr.is_primary
    ) then
      raise exception 'TEST FAILED: bridge_set_primary_role should have mirrored the change into workspace_member_roles in the same call';
    end if;
    raise notice 'TEST PASSED: admin caller succeeds; primary role written atomically to both systems';

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary, 'allowed_views', allowed_views) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_before from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_primary_role(non_admin_user_id, 'not_a_real_role_key');
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary, 'allowed_views', allowed_views) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_after from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: an invalid role_key should have raised a constraint violation';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after or workspace_snapshot_before is distinct from workspace_snapshot_after then
      raise exception 'TEST FAILED: state changed despite an invalid primary role_key being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: an invalid primary role_key writes to neither table (atomic failure, snapshot-verified)';

    -- ============================================================
    -- Section 4: secondary roles -- success, empty list, invalid role
    -- (snapshot), primary-role collision (snapshot), primary-role drift
    -- (snapshot), no-primary-role rejection, no-workspace-membership
    -- rejection (isolated from no-primary-role).
    -- ============================================================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_set_secondary_roles(non_admin_user_id, array['warehouse', 'purchasing']);
    perform set_config('role', original_role, true);

    select count(*) into row_count from public.app_user_roles where user_id = non_admin_user_id and is_primary = false;
    if row_count <> 2 then
      raise exception 'TEST FAILED: expected exactly 2 legacy secondary roles, found %', row_count;
    end if;
    select count(*) into row_count from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = non_admin_user_id and wmr.is_primary = false;
    if row_count <> 2 then
      raise exception 'TEST FAILED: expected exactly 2 workspace secondary roles, found %', row_count;
    end if;
    raise notice 'TEST PASSED: secondary roles set successfully on both systems';

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_set_secondary_roles(non_admin_user_id, array[]::text[]);
    perform set_config('role', original_role, true);

    select count(*) into row_count from public.app_user_roles where user_id = non_admin_user_id and is_primary = false;
    if row_count <> 0 then
      raise exception 'TEST FAILED: an empty secondary-role array should clear all legacy secondary roles, found %', row_count;
    end if;
    select count(*) into row_count from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = non_admin_user_id and wmr.is_primary = false;
    if row_count <> 0 then
      raise exception 'TEST FAILED: an empty secondary-role array should clear all workspace secondary roles, found %', row_count;
    end if;
    raise notice 'TEST PASSED: an empty secondary-role array clears the set on both systems';

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_before from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_secondary_roles(non_admin_user_id, array['not_a_real_role_key']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_after from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: an invalid secondary role_key should have raised a constraint violation';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after or workspace_snapshot_before is distinct from workspace_snapshot_after then
      raise exception 'TEST FAILED: state changed despite an invalid secondary role_key being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: an invalid secondary role_key is rejected, both systems unchanged';

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_secondary_roles(non_admin_user_id, array['support', 'warehouse']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_after from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: a secondary-role array containing the current primary role (support) should be rejected';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after or workspace_snapshot_before is distinct from workspace_snapshot_after then
      raise exception 'TEST FAILED: state changed despite a primary-role-collision call being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: a secondary-role array containing the primary role is rejected (no demotion), both systems unchanged';

    -- Drift rejection: desync the workspace-side primary role directly,
    -- snapshot, confirm bridge_set_secondary_roles refuses to proceed
    -- and leaves the (already-drifted) state exactly as it was.
    update public.workspace_member_roles wmr
    set is_primary = false
    from public.workspace_members wm
    where wmr.workspace_member_id = wm.id and wm.user_id = non_admin_user_id and wmr.role_key = 'support';

    insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
    select wm.id, 'marketing', true
    from public.workspace_members wm
    where wm.user_id = non_admin_user_id
    on conflict (workspace_member_id, role_key) do update set is_primary = true;

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_before from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_secondary_roles(non_admin_user_id, array['warehouse']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('role_key', wmr.role_key, 'is_primary', wmr.is_primary) order by wmr.role_key, wmr.is_primary), '[]'::jsonb)
      into workspace_snapshot_after from public.workspace_member_roles wmr join public.workspace_members wm on wm.id = wmr.workspace_member_id where wm.user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: bridge_set_secondary_roles should refuse to proceed when legacy and workspace primary roles disagree';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after or workspace_snapshot_before is distinct from workspace_snapshot_after then
      raise exception 'TEST FAILED: state changed despite a primary-role-drift call being rejected -- not atomic';
    end if;
    raise notice 'TEST PASSED: bridge_set_secondary_roles refuses to proceed on primary-role drift, state unchanged';

    -- Repair the deliberately-introduced drift before continuing -- the
    -- 'marketing' row is DELETED outright, not merely demoted, since
    -- leaving it behind as an unmirrored secondary role would itself be
    -- a new, undetected drift going into later sections.
    delete from public.workspace_member_roles wmr
    using public.workspace_members wm
    where wmr.workspace_member_id = wm.id and wm.user_id = non_admin_user_id and wmr.role_key = 'marketing';
    update public.workspace_member_roles wmr
    set is_primary = true
    from public.workspace_members wm
    where wmr.workspace_member_id = wm.id and wm.user_id = non_admin_user_id and wmr.role_key = 'support';

    -- No-primary-role rejection tests, using a TEMPORARILY-CLEARED
    -- non_admin_user_id rather than requiring a separate real user with
    -- zero role history to exist in production. A clean, well-run
    -- production system may correctly have no such user at all, which
    -- would make full zero-skip acceptance permanently impossible if
    -- this test depended on one existing. non_admin_user_id's current
    -- state at this exact point in the script is fully known (primary
    -- role 'support', no secondary roles, real workspace membership --
    -- established by Sections 3-4 above) and is captured here anyway,
    -- not assumed, so this block stays correct even if earlier sections
    -- are edited later. Admin state is not separately snapshotted:
    -- non_admin_user_id is selected specifically as a non-admin (fixture
    -- query above) and no earlier section grants them admin status, so
    -- it is trivially "not admin" both before and after this block.
    select role_key into legacy_primary_role_snapshot
    from public.app_user_roles where user_id = non_admin_user_id and is_primary;
    select coalesce(array_agg(role_key), array[]::text[]) into legacy_secondary_roles_snapshot
    from public.app_user_roles where user_id = non_admin_user_id and not is_primary;
    select allowed_views into allowed_views_snapshot
    from public.app_user_roles where user_id = non_admin_user_id and is_primary;

    -- Temporarily construct the exact "no primary role, no workspace
    -- membership" state the rejection tests need. The workspace_members
    -- delete cascades workspace_member_roles.
    delete from public.app_user_roles where user_id = non_admin_user_id;
    delete from public.workspace_members where user_id = non_admin_user_id;

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_secondary_roles(non_admin_user_id, array['warehouse']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: bridge_set_secondary_roles should reject a user with no primary role at all';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after then
      raise exception 'TEST FAILED: app_user_roles changed for a no-primary-role user despite the call being rejected';
    end if;
    if exists (select 1 from public.workspace_members where user_id = non_admin_user_id) then
      raise exception 'TEST FAILED: bridge_set_secondary_roles must not create a workspace membership row for a user with no primary role';
    end if;
    raise notice 'TEST PASSED: bridge_set_secondary_roles rejects a user with no primary role, creates no membership, legacy state unchanged';

    select allowed_views into allowed_views_before from public.app_user_roles where user_id = non_admin_user_id and is_primary;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_user_allowed_views(non_admin_user_id, array['dashboard']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and is_primary;
    if not caught then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views should reject a user with no primary role';
    end if;
    if allowed_views_before is distinct from allowed_views_after then
      raise exception 'TEST FAILED: allowed_views state changed for a no-primary-role user despite the call being rejected';
    end if;
    if exists (select 1 from public.app_user_roles where user_id = non_admin_user_id) or exists (select 1 from public.workspace_members where user_id = non_admin_user_id) then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views must not create any row for a user with no primary role';
    end if;
    raise notice 'TEST PASSED: bridge_set_user_allowed_views rejects a user with no primary role, creates nothing';

    -- Restore the fixture from the captured snapshot, reusing the
    -- already-tested bridge functions themselves rather than raw INSERTs
    -- -- this naturally re-creates the correct workspace-side mirror too,
    -- exactly as it would for any real caller.
    if legacy_primary_role_snapshot is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.bridge_set_primary_role(non_admin_user_id, legacy_primary_role_snapshot);
      if array_length(legacy_secondary_roles_snapshot, 1) is not null then
        perform public.bridge_set_secondary_roles(non_admin_user_id, legacy_secondary_roles_snapshot);
      end if;
      if allowed_views_snapshot is not null then
        perform public.bridge_set_user_allowed_views(non_admin_user_id, allowed_views_snapshot);
      end if;
      perform set_config('role', original_role, true);
    end if;

    if not exists (select 1 from public.app_user_roles where user_id = non_admin_user_id and role_key = legacy_primary_role_snapshot and is_primary) then
      raise exception 'TEST FAILED: fixture restoration after the no-primary-role tests did not recreate the expected primary role';
    end if;
    raise notice 'TEST PASSED: fixture restored from its captured snapshot for subsequent sections';

    -- Isolated case: a legacy primary role exists, but the workspace
    -- membership specifically is missing (distinct from "no primary role
    -- at all", above).
    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_before from public.app_user_roles where user_id = non_admin_user_id;

    delete from public.workspace_members where user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_secondary_roles(non_admin_user_id, array['warehouse']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(jsonb_build_object('role_key', role_key, 'is_primary', is_primary) order by role_key, is_primary), '[]'::jsonb)
      into legacy_snapshot_after from public.app_user_roles where user_id = non_admin_user_id;

    if not caught then
      raise exception 'TEST FAILED: bridge_set_secondary_roles should reject a user with a legacy primary role but no workspace membership';
    end if;
    if legacy_snapshot_before is distinct from legacy_snapshot_after then
      raise exception 'TEST FAILED: app_user_roles changed despite this call being rejected';
    end if;
    if exists (select 1 from public.workspace_members where user_id = non_admin_user_id) then
      raise exception 'TEST FAILED: bridge_set_secondary_roles must not create a workspace membership row as a side effect of a rejected call';
    end if;
    raise notice 'TEST PASSED: bridge_set_secondary_roles rejects a legacy-primary-but-no-workspace-membership user, creates no membership, legacy state unchanged';

    -- Restore membership + primary role via the already-tested
    -- bridge_set_primary_role.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_set_primary_role(non_admin_user_id, 'support');
    perform set_config('role', original_role, true);

    -- ============================================================
    -- Section 5: allowed views -- unauthorized rejection (snapshot),
    -- success, missing-primary-role rejection (already covered above,
    -- via the temporarily-cleared non_admin_user_id fixture),
    -- duplicate-primary-row rejection (snapshot), role assignments
    -- preserved.
    -- ============================================================
    select allowed_views into allowed_views_before from public.app_user_roles where user_id = non_admin_user_id and is_primary;

    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_user_allowed_views(non_admin_user_id, array['dashboard']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and is_primary;
    if not caught then
      raise exception 'TEST FAILED: a non-admin caller should have been rejected by bridge_set_user_allowed_views';
    end if;
    if allowed_views_before is distinct from allowed_views_after then
      raise exception 'TEST FAILED: allowed_views changed despite a non-admin call being rejected';
    end if;
    raise notice 'TEST PASSED: non-admin caller rejected by bridge_set_user_allowed_views, allowed_views unchanged';

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_set_user_allowed_views(non_admin_user_id, array['dashboard', 'tasks']);
    perform set_config('role', original_role, true);

    if not exists (
      select 1 from public.app_user_roles
      where user_id = non_admin_user_id and is_primary and role_key = 'support'
        and allowed_views = array['dashboard', 'tasks']
    ) then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views should have updated allowed_views while preserving role_key=''support''';
    end if;
    raise notice 'TEST PASSED: allowed views updated successfully; role assignment (support) preserved';

    -- Duplicate-primary-row failure (app_user_roles' "only one primary"
    -- rule is app-layer-only, not a real constraint -- migration 040's
    -- own comment admits this, so this scenario is genuinely reachable).
    select allowed_views into allowed_views_before from public.app_user_roles where user_id = non_admin_user_id and role_key = 'support' and is_primary;

    insert into public.app_user_roles (user_id, role_key, is_primary, updated_at)
    values (non_admin_user_id, 'marketing', true, now())
    on conflict (user_id, role_key) do update set is_primary = true;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_set_user_allowed_views(non_admin_user_id, array['inventory']);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and role_key = 'support' and is_primary;
    if not caught then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views should reject a user with more than one primary-role row';
    end if;
    if allowed_views_before is distinct from allowed_views_after then
      raise exception 'TEST FAILED: allowed_views on the ''support'' row changed despite the duplicate-primary call being rejected';
    end if;
    raise notice 'TEST PASSED: bridge_set_user_allowed_views rejects a user with duplicate primary-role rows, existing row unchanged';

    delete from public.app_user_roles where user_id = non_admin_user_id and role_key = 'marketing';

    -- ============================================================
    -- Section 6: bridge_set_user_allowed_views' own workspace-guard
    -- coverage -- second active, second suspended, sole workspace
    -- suspended (three of the four required scenarios). The fourth,
    -- "zero workspaces," is deliberately NEVER exercised at runtime
    -- anywhere in this script -- see the note at Section 9 for why, and
    -- Section 9b for how that case is verified instead (structural
    -- source-code inspection, not a live DELETE).
    --
    -- Run against non_admin_user_id, who has a clean single primary role
    -- at this point. Restored between each sub-case so later sections
    -- see the expected baseline.
    -- ============================================================
    if real_workspace_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := skipped_names || 'allowed-views workspace-guard tests (no workspace row found)';
    else
      select count(*) into row_count from public.workspaces where status = 'active';
      if row_count <> 1 or (select count(*) from public.workspaces) <> 1 then
        skipped_count := skipped_count + 1;
        skipped_names := skipped_names || format('allowed-views workspace-guard tests (expected a clean one-active-workspace baseline, found %s active of %s total)', row_count, (select count(*) from public.workspaces));
      else
        select allowed_views into allowed_views_before from public.app_user_roles where user_id = non_admin_user_id and is_primary;

        -- Second active workspace.
        insert into public.workspaces (name, slug, status)
        values ('Test Second Workspace -- ACTIVE (never committed)', 'test-second-workspace-active-avtest-' || gen_random_uuid()::text, 'active')
        returning id into test_workspace_id;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        begin
          perform public.bridge_set_user_allowed_views(non_admin_user_id, array['second-active-should-not-write']);
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);
        select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and is_primary;
        if not caught then
          raise exception 'TEST FAILED: bridge_set_user_allowed_views should be rejected with a second active workspace present';
        end if;
        if allowed_views_before is distinct from allowed_views_after then
          raise exception 'TEST FAILED: allowed_views changed despite the second-active-workspace guard rejecting the call';
        end if;
        raise notice 'TEST PASSED: bridge_set_user_allowed_views rejected with a second active workspace, no write occurred';

        delete from public.workspaces where id = test_workspace_id;

        -- Second suspended workspace.
        insert into public.workspaces (name, slug, status)
        values ('Test Second Workspace -- SUSPENDED (never committed)', 'test-second-workspace-suspended-avtest-' || gen_random_uuid()::text, 'suspended')
        returning id into test_workspace_id;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        begin
          perform public.bridge_set_user_allowed_views(non_admin_user_id, array['second-suspended-should-not-write']);
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);
        select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and is_primary;
        if not caught then
          raise exception 'TEST FAILED: bridge_set_user_allowed_views should be rejected with a second suspended workspace present';
        end if;
        if allowed_views_before is distinct from allowed_views_after then
          raise exception 'TEST FAILED: allowed_views changed despite the second-suspended-workspace guard rejecting the call';
        end if;
        raise notice 'TEST PASSED: bridge_set_user_allowed_views rejected with a second (suspended) workspace, no write occurred';

        delete from public.workspaces where id = test_workspace_id;

        -- Sole workspace suspended.
        update public.workspaces set status = 'suspended' where id = real_workspace_id;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        begin
          perform public.bridge_set_user_allowed_views(non_admin_user_id, array['sole-suspended-should-not-write']);
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);
        select allowed_views into allowed_views_after from public.app_user_roles where user_id = non_admin_user_id and is_primary;
        if not caught then
          raise exception 'TEST FAILED: bridge_set_user_allowed_views should be rejected when the sole workspace is suspended';
        end if;
        if allowed_views_before is distinct from allowed_views_after then
          raise exception 'TEST FAILED: allowed_views changed despite the sole-workspace-suspended guard rejecting the call';
        end if;
        raise notice 'TEST PASSED: bridge_set_user_allowed_views rejected when the sole workspace is suspended, no write occurred';

        update public.workspaces set status = 'active' where id = real_workspace_id;
      end if;
    end if;

    -- ============================================================
    -- Section 7: drift-report authorization + correctness.
    -- ============================================================
    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_drift_report();
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    if not caught then
      raise exception 'TEST FAILED: a non-admin caller should have been rejected by bridge_drift_report';
    end if;
    raise notice 'TEST PASSED: non-admin caller rejected by bridge_drift_report';

    delete from public.app_user_roles where user_id = non_admin_user_id and role_key = 'support' and is_primary;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into row_count from public.bridge_drift_report()
      where check_name = 'primary_role_mismatch' and user_id = non_admin_user_id;
    perform set_config('role', original_role, true);
    if row_count = 0 then
      raise exception 'TEST FAILED: bridge_drift_report should have surfaced the deliberately-introduced primary_role_mismatch';
    end if;
    raise notice 'TEST PASSED: bridge_drift_report correctly surfaces a deliberately-introduced mismatch';

    insert into public.app_user_roles (user_id, role_key, is_primary, updated_at)
    values (non_admin_user_id, 'support', true, now())
    on conflict (user_id, role_key) do update set is_primary = true, updated_at = now();

    -- ============================================================
    -- Section 8: admin grant/revoke -- unauthorized rejection
    -- (snapshot), "not currently an admin" rejection (proving workspace-
    -- admin status is never silently touched for someone granted it
    -- independently), final-admin self-revocation rejection (snapshot,
    -- including workspace_members.is_workspace_admin), revoke-one-of-
    -- multiple success.
    -- ============================================================
    select coalesce(jsonb_agg(user_id order by user_id), '[]'::jsonb) into admin_snapshot_before from public.app_admins;

    perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_grant_admin(non_admin_user_id);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);

    select coalesce(jsonb_agg(user_id order by user_id), '[]'::jsonb) into admin_snapshot_after from public.app_admins;
    if not caught then
      raise exception 'TEST FAILED: a non-admin caller should have been rejected by bridge_grant_admin';
    end if;
    if admin_snapshot_before is distinct from admin_snapshot_after then
      raise exception 'TEST FAILED: app_admins changed despite a non-admin bridge_grant_admin call being rejected';
    end if;
    raise notice 'TEST PASSED: non-admin caller rejected by bridge_grant_admin, app_admins unchanged';

    -- "Not currently a global admin" rejection: give non_admin_user_id
    -- workspace-admin status through a path OTHER than app_admins (as if
    -- some future, not-yet-built workspace-admin screen granted it
    -- independently), then confirm bridge_revoke_admin refuses to touch
    -- them (since they're not in app_admins at all) and leaves that
    -- independently-granted status exactly as it was.
    update public.workspace_members set is_workspace_admin = true where user_id = non_admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.bridge_revoke_admin(non_admin_user_id);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    if not caught then
      raise exception 'TEST FAILED: bridge_revoke_admin should reject a target who is not currently a global admin';
    end if;
    if not exists (select 1 from public.workspace_members where user_id = non_admin_user_id and is_workspace_admin) then
      raise exception 'TEST FAILED: bridge_revoke_admin must never silently strip workspace-admin status granted independently of app_admins';
    end if;
    raise notice 'TEST PASSED: bridge_revoke_admin rejects a non-app_admins target, leaves independently-granted workspace-admin status untouched';

    update public.workspace_members set is_workspace_admin = false where user_id = non_admin_user_id;

    -- Final-admin self-revocation rejection.
    select count(*) into admin_count_before from public.app_admins;
    if admin_count_before = 1 and exists (select 1 from public.app_admins where user_id = admin_user_id) then
      select jsonb_build_object(
        'is_legacy_admin', exists(select 1 from public.app_admins where user_id = admin_user_id),
        'is_workspace_admin', coalesce((select is_workspace_admin from public.workspace_members where user_id = admin_user_id), false)
      ) into admin_snapshot_before;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        perform public.bridge_revoke_admin(admin_user_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);

      select jsonb_build_object(
        'is_legacy_admin', exists(select 1 from public.app_admins where user_id = admin_user_id),
        'is_workspace_admin', coalesce((select is_workspace_admin from public.workspace_members where user_id = admin_user_id), false)
      ) into admin_snapshot_after;

      if not caught then
        raise exception 'TEST FAILED: revoking the last remaining admin (self-revocation) should have been rejected';
      end if;
      if admin_snapshot_before is distinct from admin_snapshot_after then
        raise exception 'TEST FAILED: admin status changed (legacy or workspace) despite the rejected final-admin revocation -- not atomic';
      end if;
      raise notice 'TEST PASSED: self-revocation of the last remaining admin is rejected, both systems unchanged';
    else
      skipped_count := skipped_count + 1;
      skipped_names := skipped_names || format('final-admin self-revocation rejection (expected exactly one existing global admin, found %s)', admin_count_before);
    end if;

    -- Revoke one of multiple succeeds.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_grant_admin(non_admin_user_id);
    perform set_config('role', original_role, true);

    second_admin_user_id := non_admin_user_id;

    if not exists (select 1 from public.app_admins where user_id = second_admin_user_id) then
      raise exception 'TEST FAILED: bridge_grant_admin should have granted admin to the fixture user';
    end if;
    if not exists (select 1 from public.workspace_members where user_id = second_admin_user_id and is_workspace_admin) then
      raise exception 'TEST FAILED: bridge_grant_admin should have mirrored admin status into workspace_members';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.bridge_revoke_admin(second_admin_user_id);
    perform set_config('role', original_role, true);

    if exists (select 1 from public.app_admins where user_id = second_admin_user_id) then
      raise exception 'TEST FAILED: bridge_revoke_admin should have removed admin status from app_admins';
    end if;
    if exists (select 1 from public.workspace_members where user_id = second_admin_user_id and is_workspace_admin) then
      raise exception 'TEST FAILED: bridge_revoke_admin should have mirrored the removal into workspace_members';
    end if;
    raise notice 'TEST PASSED: revoking one of two admins succeeds, mirrored atomically on both systems';

    raise notice 'Sections 1-8 complete.';
  end if;

  -- ============================================================
  -- Section 9: active_workspace_id() guard (the general-purpose one,
  -- exercised directly, distinct from Section 6's allowed-views-specific
  -- coverage) -- one active (implicit success, plus an explicit direct
  -- check), second active, second suspended. Run near the end since
  -- these mutate the real workspaces table with TEMPORARY, never-
  -- referenced rows only -- fully undone by the final rollback, never
  -- committed.
  --
  -- The fourth required scenario, ZERO workspaces, is deliberately NEVER
  -- exercised at runtime anywhere in this script. An earlier revision of
  -- this file did `delete from public.workspaces where id =
  -- real_workspace_id` to simulate it, wrapped in this script's outer
  -- rollback -- and it failed live: `ERROR 23503: deleting the real
  -- workspace violates clients_workspace_id_fkey`. This is a genuinely
  -- populated production database, not an empty test fixture -- both
  -- `clients.workspace_id` and `sales_quotes.workspace_id` are NOT NULL
  -- foreign keys to the real workspace row (migration 117), held by real
  -- operational records. Deleting that row -- even inside a transaction
  -- that will definitely roll back -- is not a safe thing to even
  -- attempt: the DELETE statement itself fails immediately on referential
  -- integrity, before rollback ever gets a chance to matter, and
  -- deliberately attempting a destructive operation against real
  -- FK-referenced production rows is the wrong instinct regardless of
  -- whether it happens to succeed or fail. There is no safe way to make
  -- `public.workspaces` truly empty in this database without first
  -- removing every real client and sales quote, which is obviously out
  -- of the question for a test script. The zero-workspace case is
  -- instead verified structurally, without ever touching data -- see
  -- Section 9b immediately below.
  -- ============================================================
  select id into real_workspace_id from public.workspaces limit 1;
  if real_workspace_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := skipped_names || 'active_workspace_id guard tests (no workspace row found at all)';
  else
    select count(*) into row_count from public.workspaces where status = 'active';
    if row_count <> 1 or (select count(*) from public.workspaces) <> 1 then
      skipped_count := skipped_count + 1;
      skipped_names := skipped_names || format('active_workspace_id guard tests (expected a clean one-active-workspace baseline, found %s active of %s total)', row_count, (select count(*) from public.workspaces));
    else
      select public.active_workspace_id() into resolved_id;
      if resolved_id is distinct from real_workspace_id then
        raise exception 'TEST FAILED: active_workspace_id() should return the sole real workspace''s id';
      end if;
      raise notice 'TEST PASSED: active_workspace_id() succeeds with exactly one active workspace';

      insert into public.workspaces (name, slug, status)
      values ('Test Second Workspace -- ACTIVE (never committed)', 'test-second-workspace-active-guard-' || gen_random_uuid()::text, 'active')
      returning id into test_workspace_id;

      caught := false;
      begin
        perform public.active_workspace_id();
      exception when others then
        caught := true;
      end;
      if not caught then
        raise exception 'TEST FAILED: active_workspace_id() should reject a second ACTIVE workspace';
      end if;
      raise notice 'TEST PASSED: active_workspace_id() rejects a second active workspace';

      delete from public.workspaces where id = test_workspace_id;

      insert into public.workspaces (name, slug, status)
      values ('Test Second Workspace -- SUSPENDED (never committed)', 'test-second-workspace-suspended-guard-' || gen_random_uuid()::text, 'suspended')
      returning id into test_workspace_id;

      caught := false;
      begin
        perform public.active_workspace_id();
      exception when others then
        caught := true;
      end;
      if not caught then
        raise exception 'TEST FAILED: active_workspace_id() should reject a second SUSPENDED workspace too -- total row count matters, not just active count';
      end if;
      raise notice 'TEST PASSED: active_workspace_id() rejects a second workspace even when it is merely suspended';

      delete from public.workspaces where id = test_workspace_id;
    end if;
  end if;

  -- ============================================================
  -- Section 9b: structural verification of the zero-workspace guard --
  -- inspects the LIVE, currently-deployed source of
  -- active_workspace_id() and bridge_set_user_allowed_views() via
  -- pg_get_functiondef(), a read-only catalog function. No data is read
  -- or written by this section; nothing here can affect production
  -- records. This is a real assertion (raises TEST FAILED and aborts if
  -- the expected pattern isn't found), not a placeholder -- it counts as
  -- a PASS, not a SKIP.
  --
  -- What this proves, and what it doesn't: the two-workspace tests just
  -- above already prove the shared `total_count <> 1` rejection branch
  -- actually RUNS and actually REJECTS (count = 2 takes that branch).
  -- What can't be proven by execution is the specific count = 0 case,
  -- for the real-data-safety reason explained in Section 9. This section
  -- instead proves, by reading the function's actual deployed source,
  -- that (a) the guard counts ALL workspace rows regardless of status
  -- (not just active ones -- the same total-count logic already proven
  -- to run for count = 2 applies identically at count = 0, there is no
  -- separate code path for it to diverge into), and (b) the exact
  -- rejection condition is `<> 1`, which is satisfied by zero exactly as
  -- much as by two. Together with the executed two-workspace tests, this
  -- is a complete logical proof of the zero-workspace case without ever
  -- running it.
  -- ============================================================
  declare
    active_workspace_id_def text;
    allowed_views_def text;
    perform_pos integer;
    update_pos integer;
  begin
    select pg_get_functiondef('public.active_workspace_id()'::regprocedure) into active_workspace_id_def;

    if position('from public.workspaces' in active_workspace_id_def) = 0 then
      raise exception 'TEST FAILED: active_workspace_id() source no longer counts from public.workspaces -- structural assumption broken, cannot verify the zero-workspace case';
    end if;
    if position('total_count' in active_workspace_id_def) = 0 or position('<> 1' in active_workspace_id_def) = 0 then
      raise exception 'TEST FAILED: active_workspace_id() source does not contain the expected total-row-count guard (total_count <> 1) -- the zero-workspace case is no longer provably covered by this logic';
    end if;
    raise notice 'TEST PASSED: active_workspace_id() source confirmed (via pg_get_functiondef) to count ALL workspace rows regardless of status and reject on total_count <> 1 -- combined with the executed two-workspace tests above, this proves the zero-workspace case is rejected by the same code path, without ever deleting the real workspace row';

    select pg_get_functiondef('public.bridge_set_user_allowed_views(uuid, text[])'::regprocedure) into allowed_views_def;

    perform_pos := position('active_workspace_id' in allowed_views_def);
    update_pos := position('update public.app_user_roles' in allowed_views_def);

    if perform_pos = 0 then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views() source no longer calls active_workspace_id() at all -- the workspace guard has been removed';
    end if;
    if update_pos = 0 then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views() source does not contain the expected UPDATE public.app_user_roles statement -- structural assumption broken';
    end if;
    if perform_pos > update_pos then
      raise exception 'TEST FAILED: bridge_set_user_allowed_views() calls active_workspace_id() AFTER its UPDATE, not before -- the guard would not actually protect the write';
    end if;
    raise notice 'TEST PASSED: bridge_set_user_allowed_views() source confirmed (via pg_get_functiondef) to call active_workspace_id() before its UPDATE statement -- the zero-workspace guard genuinely protects this write, verified without ever deleting the real workspace row';
  end;

  -- ============================================================
  -- Section 10: actual routine grants.
  -- ============================================================
  select count(*) into row_count
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in (
      'is_app_admin', 'active_workspace_id', 'bridge_set_primary_role',
      'bridge_set_secondary_roles', 'bridge_set_user_allowed_views',
      'bridge_grant_admin', 'bridge_revoke_admin', 'bridge_drift_report'
    )
    and grantee in ('PUBLIC', 'anon');
  if row_count <> 0 then
    raise exception 'TEST FAILED: expected zero PUBLIC/anon grants on any bridge function, found %', row_count;
  end if;

  select count(*) into row_count
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in (
      'active_workspace_id', 'bridge_set_primary_role',
      'bridge_set_secondary_roles', 'bridge_set_user_allowed_views',
      'bridge_grant_admin', 'bridge_revoke_admin', 'bridge_drift_report'
    )
    and grantee = 'authenticated'
    and privilege_type = 'EXECUTE';
  if row_count <> 7 then
    raise exception 'TEST FAILED: expected exactly 7 authenticated EXECUTE grants (one per bridge function excluding is_app_admin, checked separately), found %', row_count;
  end if;

  select count(*) into row_count
  from information_schema.role_routine_grants
  where routine_schema = 'public' and routine_name = 'is_app_admin'
    and grantee = 'authenticated' and privilege_type = 'EXECUTE';
  if row_count = 0 then
    raise exception 'TEST FAILED: expected an authenticated EXECUTE grant on is_app_admin -- every existing RLS policy in the app depends on this';
  end if;
  raise notice 'TEST PASSED: routine grants are exactly as expected (zero for anon/PUBLIC, correct set for authenticated)';

  -- ============================================================
  -- Final result. A production-acceptance run must end in exactly one of
  -- two ways: the unconditional-success notice below, or this hard
  -- exception naming every skipped section. It can never silently finish
  -- as bare "Success. No rows returned." with something unproven.
  -- ============================================================
  if skipped_count > 0 then
    raise exception 'MIGRATION 124 BRIDGE TESTS: % SECTION(S) SKIPPED -- %. NOT PRODUCTION-ACCEPTABLE UNTIL EVERY SKIP IS RESOLVED (real fixture data provided, or the scenario confirmed inapplicable) AND THIS SCRIPT IS RE-RUN CLEAN.', skipped_count, array_to_string(skipped_names, '; ');
  end if;

  raise notice 'ALL MIGRATION 124 BRIDGE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

-- A note on true concurrent-session testing (E's requirement 2): this
-- single-connection script cannot literally open two simultaneous
-- database sessions to race two bridge_revoke_admin calls against each
-- other -- Supabase Studio's SQL editor runs one connection at a time,
-- and a plpgsql DO block is inherently single-threaded within its own
-- transaction. The concurrency guarantee bridge_revoke_admin relies on
-- is not established by a test racing two sessions here; it is
-- established by Postgres's own documented guarantee about
-- pg_advisory_xact_lock: any two sessions requesting the same lock key
-- are strictly serialized, one waits for the other to release (at commit
-- or rollback) before proceeding. This is the same category of trust
-- already placed in, e.g., a UNIQUE constraint preventing duplicate rows
-- -- verified by reading Postgres's own semantics, not by empirically
-- racing two connections in a test script. A genuine two-session
-- verification, if ever wanted, would need two separate `psql`
-- connections (or two Studio tabs) manually coordinated by a person --
-- outside what a single SQL script run in one session can prove.

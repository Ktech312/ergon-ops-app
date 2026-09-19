-- Transaction-safe canonical test for migration 183 (app_records /
-- app_state_snapshots workspace scoping). Wrapped in begin;/rollback; --
-- nothing here ever commits. The synthetic second workspace lives ONLY
-- inside this rolled-back transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 183 APP RECORDS STATE
-- SNAPSHOTS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or
-- a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  seen_workspace_id uuid;
  visible_count int;
  data_seen jsonb;
  snap_a_id uuid;
  snap_b_id uuid;
begin
  select am.user_id, wm.workspace_id, wm.is_workspace_admin
    into real_user_id, real_workspace_id, real_member_was_admin
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_183 Other Workspace', 'zz-test-183-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  -- Clear out any pre-existing 'roleMode' row so this test starts from a
  -- known state regardless of what production data already looks like.
  delete from public.app_records where record_key in ('roleMode', 'inventoryItems') and workspace_id = real_workspace_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: an authenticated workspace member can insert app_records'
  -- live 'roleMode' key and its workspace_id derives from the caller's
  -- own resolved workspace (guard_workspace_id_mutation), not from
  -- anything the client sends.
  -- ============================================================

  insert into public.app_records (workspace_key, record_key, data)
    values ('default', 'roleMode', '"warehouse"'::jsonb)
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: app_records.workspace_id did not derive from the caller''s own resolved workspace (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 1 -- app_records.workspace_id derives from the inserting caller''s workspace';

  -- ============================================================
  -- Section 2: guard_workspace_id_mutation ignores/overwrites a spoofed
  -- workspace_id on INSERT, exactly like every other root table this
  -- session -- a caller cannot write into another workspace's row by
  -- naming it explicitly. Uses a different record_key ('inventoryItems',
  -- a dead-but-still-check-constraint-legal literal) so this does not
  -- collide with Section 1's (real_workspace_id, 'roleMode') row.
  -- ============================================================

  insert into public.app_records (workspace_key, record_key, data, workspace_id)
    values ('default', 'inventoryItems', '{}'::jsonb, ws_b)
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: a caller-supplied workspace_id (%) was not overwritten by guard_workspace_id_mutation -- got %, expected the caller''s own workspace %', ws_b, seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 2 -- a spoofed workspace_id on INSERT is overwritten by the caller''s own resolved workspace';

  -- ============================================================
  -- Section 3: the real upsert path saveRemoteAppState() uses --
  -- INSERT ... ON CONFLICT (workspace_id, record_key) DO UPDATE --
  -- fires the trigger's INSERT branch (stamping workspace_id) even
  -- though the row ultimately updates, and the UPDATE branch's
  -- immutability check passes because the payload never sends
  -- workspace_id, so NEW.workspace_id carries forward from OLD
  -- unchanged. This is the exact concern the migration's own header
  -- flags -- verified empirically here, not just reasoned about.
  -- ============================================================

  insert into public.app_records (workspace_key, record_key, data)
    values ('default', 'roleMode', '"manager"'::jsonb)
    on conflict (workspace_id, record_key) do update
    set data = excluded.data, updated_at = now();

  select workspace_id, data into seen_workspace_id, data_seen
  from public.app_records where workspace_id = real_workspace_id and record_key = 'roleMode';

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: workspace_id changed across the upsert''s ON CONFLICT DO UPDATE path (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;
  if data_seen is distinct from '"manager"'::jsonb then
    raise exception 'TEST FAILED: the upsert''s ON CONFLICT DO UPDATE branch did not apply, data is still %', data_seen;
  end if;

  raise notice 'TEST PASSED: Section 3 -- the real INSERT ... ON CONFLICT DO UPDATE upsert path preserves workspace_id and applies the update';

  -- ============================================================
  -- Section 4: the actual bug being fixed -- two different workspaces
  -- can now each have their own 'roleMode' row without colliding into
  -- the single physically-shared row every company used to share via
  -- the literal workspace_key = 'default'. Temporarily move the real
  -- user into workspace B to insert its own 'roleMode' row.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.app_records (workspace_key, record_key, data)
    values ('default', 'roleMode', '"pm"'::jsonb)
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from ws_b then
    raise exception 'TEST FAILED: workspace B''s own roleMode insert did not derive workspace_id = workspace B (got %)', seen_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into visible_count from public.app_records where workspace_id = real_workspace_id and record_key = 'roleMode';
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace A''s original roleMode row was affected by workspace B''s insert (expected exactly 1 surviving row, found %)', visible_count;
  end if;

  raise notice 'TEST PASSED: Section 4 -- two different workspaces each hold their own independent roleMode row with no collision';

  -- ============================================================
  -- Section 5: cross-workspace read denial (row-count check, not
  -- exception-based -- SELECT-side RLS denial is silent, per this
  -- repo's own documented 171/174 lesson). The real user is currently a
  -- member of workspace B only (from Section 4) -- confirm they cannot
  -- see workspace A's roleMode row, then restore membership and confirm
  -- they can again.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.app_records where workspace_id = real_workspace_id and record_key = 'roleMode';
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s app_records roleMode row'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.app_records where workspace_id = real_workspace_id and record_key = 'roleMode';
  if visible_count <> 1 then raise exception 'TEST FAILED: a workspace-A caller could not read their own app_records roleMode row after being restored'; end if;

  select data into data_seen from public.app_records where workspace_id = real_workspace_id and record_key = 'roleMode';
  if data_seen is distinct from '"manager"'::jsonb then
    raise exception 'TEST FAILED: workspace A''s roleMode row data was corrupted by workspace B''s activity, found %', data_seen;
  end if;

  raise notice 'TEST PASSED: Section 5 -- app_records cross-workspace read is blocked and workspace A''s own row is intact and readable';

  -- ============================================================
  -- Section 6: app_state_snapshots -- same workspace-scoped read
  -- containment (its own write policy for `authenticated` has been gone
  -- since migration 009:64, so only read behavior is exercised here).
  -- Rows inserted directly as `postgres` (bypassing RLS) to set up the
  -- fixture, matching how a legacy row would already exist -- with the
  -- new guard trigger TEMPORARILY disabled for this raw two-workspace
  -- seed only: guard_workspace_id_mutation() always overwrites
  -- workspace_id from the CALLER's own resolved workspace regardless of
  -- role (it is a trigger, not an RLS policy, so `postgres` does not
  -- bypass it) -- correct behavior for a real caller-driven insert, but
  -- it means a raw admin seed of two DIFFERENT workspaces' rows (as any
  -- one real caller identity) cannot go through the trigger unmodified,
  -- exactly like a real one-off historical-data backfill script
  -- wouldn't either. Re-enabled immediately after.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  alter table public.app_state_snapshots disable trigger app_state_snapshots_guard_workspace_id;

  insert into public.app_state_snapshots (workspace_key, state, workspace_id)
    values ('default', '{"roleMode":"manager"}'::jsonb, real_workspace_id)
    returning id into snap_a_id;
  insert into public.app_state_snapshots (workspace_key, state, workspace_id)
    values ('zz-test-183-b', '{"roleMode":"pm"}'::jsonb, ws_b)
    returning id into snap_b_id;

  alter table public.app_state_snapshots enable trigger app_state_snapshots_guard_workspace_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.app_state_snapshots where id = snap_a_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a workspace-A caller could not read their own app_state_snapshots row'; end if;

  select count(*) into visible_count from public.app_state_snapshots where id = snap_b_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-A caller could read workspace B''s app_state_snapshots row'; end if;

  raise notice 'TEST PASSED: Section 6 -- app_state_snapshots cross-workspace read is blocked, own-workspace read still works';

  raise notice 'ALL MIGRATION 183 APP RECORDS STATE SNAPSHOTS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

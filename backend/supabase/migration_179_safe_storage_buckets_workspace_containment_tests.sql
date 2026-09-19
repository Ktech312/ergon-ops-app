-- Transaction-safe canonical test for migration 179 (project-location-
-- images / project-shipment-photos / avatars storage bucket
-- containment). Wrapped in begin;/rollback; -- nothing here ever
-- commits. The synthetic second workspace lives ONLY inside this
-- rolled-back transaction. Depends on migration 175 (team_members.
-- workspace_id) already being applied -- run 175's migration before
-- this test.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 179 SAFE STORAGE
-- BUCKETS WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED",
-- or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  project_a_id uuid;
  project_b_id uuid;
  loc_a_id uuid;
  loc_b_id uuid;
  shipment_a_id uuid;
  shipment_b_id uuid;
  member_a_id uuid;
  member_b_id uuid;
  bogus_id uuid := gen_random_uuid();
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
    values (ws_b, 'ZZ_TEST_179 Other Workspace', 'zz-test-179-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_179 Project A') returning id into project_a_id;
  insert into public.project_locations (project_id, location_type) values (project_a_id, 'garage') returning id into loc_a_id;
  insert into public.project_shipments (project_id, shipment_number) values (project_a_id, 'ZZ-TEST-179-SHIP-A') returning id into shipment_a_id;
  insert into public.team_members (full_name, email) values ('ZZ_TEST_179 Person A', 'zz-test-179-a@example.com') returning id into member_a_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_179 Project B') returning id into project_b_id;
  insert into public.project_locations (project_id, location_type) values (project_b_id, 'garage') returning id into loc_b_id;
  insert into public.project_shipments (project_id, shipment_number) values (project_b_id, 'ZZ-TEST-179-SHIP-B') returning id into shipment_b_id;
  insert into public.team_members (full_name, email) values ('ZZ_TEST_179 Person B', 'zz-test-179-b@example.com') returning id into member_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: project-location-images -- upload with no pre-existing
  -- metadata row succeeds (parent-anchor, no chicken-and-egg bug), but
  -- cross-workspace and nonexistent-location uploads are rejected.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-location-images', loc_a_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: uploading a project-location-images object for the caller''s own workspace location was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-location-images', loc_b_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to upload into workspace B''s project-location-images location'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-location-images', bogus_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to upload against a project_locations id that does not exist at all'; end if;

  raise notice 'TEST PASSED: Section 1 -- project-location-images uploads are correctly contained';

  -- ============================================================
  -- Section 2: project-shipment-photos -- same pattern.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-shipment-photos', shipment_a_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: uploading a project-shipment-photos object for the caller''s own workspace shipment was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-shipment-photos', shipment_b_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to upload into workspace B''s project-shipment-photos shipment'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-shipment-photos', bogus_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to upload against a project_shipments id that does not exist at all'; end if;

  raise notice 'TEST PASSED: Section 2 -- project-shipment-photos uploads are correctly contained';

  -- ============================================================
  -- Section 3: avatars -- only the write-side policies gain a
  -- workspace check. A workspace-A admin may write an avatar for their
  -- own workspace's roster member, but not for workspace B's. Read
  -- policy is deliberately untouched by migration 179 -- not retested
  -- here since it did not change.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', member_a_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: an admin was rejected writing an avatar for their own workspace''s roster member'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', member_b_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: an admin in workspace A was able to write an avatar for workspace B''s roster member'; end if;

  raise notice 'TEST PASSED: Section 3 -- avatars write-side is correctly contained by workspace';

  raise notice 'ALL MIGRATION 179 SAFE STORAGE BUCKETS WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

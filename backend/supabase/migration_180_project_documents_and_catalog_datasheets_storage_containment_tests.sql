-- Transaction-safe canonical test for migration 180 (project-documents /
-- catalog-datasheets storage bucket containment). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace lives ONLY inside this rolled-back transaction. Depends on
-- migration 170 (project_documents/projects workspace scoping) and
-- migration 176 (product_catalog.workspace_id) already being applied --
-- run those migrations before this test.
--
-- Exercises BOTH match branches migration 180 adds for each bucket:
--   - NEW scheme: leading path segment is the real anchor row's id.
--   - LEGACY scheme: leading path segment is the anchor row's sanitized
--     name/catalog_number (project_name / catalog_number), reproducing
--     src/persistence.ts's sanitizeStoragePathSegment (non
--     [a-zA-Z0-9_.-] runs collapsed to a single "_", case preserved).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 180 PROJECT-DOCUMENTS
-- AND CATALOG-DATASHEETS STORAGE CONTAINMENT TESTS PASSED -- ZERO
-- SECTIONS SKIPPED", or a hard SQL error naming what failed or was
-- skipped.

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
  catalog_a_id uuid;
  catalog_b_id uuid;
  bogus_id uuid := gen_random_uuid();
  legacy_name_a text := 'ZZ TEST 180 Project! A';
  legacy_name_b text := 'ZZ TEST 180 Project! B';
  legacy_catalog_a text := 'ZZ-TEST-180/CAT-A';
  legacy_catalog_b text := 'ZZ-TEST-180/CAT-B';
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
    values (ws_b, 'ZZ_TEST_180 Other Workspace', 'zz-test-180-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values (legacy_name_a) returning id into project_a_id;
  insert into public.product_catalog (catalog_number, product_name) values (legacy_catalog_a, 'ZZ_TEST_180 Catalog Item A') returning id into catalog_a_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values (legacy_name_b) returning id into project_b_id;
  insert into public.product_catalog (catalog_number, product_name) values (legacy_catalog_b, 'ZZ_TEST_180 Catalog Item B') returning id into catalog_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: project-documents, NEW (id-based) scheme.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', project_a_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: a NEW-scheme (id-based) upload for the caller''s own workspace project was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', project_b_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to NEW-scheme upload into workspace B''s project'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', bogus_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to NEW-scheme upload against a projects id that does not exist at all'; end if;

  caught := false;
  begin
    perform 1 from storage.objects where bucket_id = 'project-documents' and name = project_a_id::text || '/stamp-fixture.pdf';
  exception when others then
    caught := true;
  end;
  if caught or not found then raise exception 'TEST FAILED: the caller could not read back their own NEW-scheme project-documents object'; end if;

  raise notice 'TEST PASSED: Section 1 -- project-documents NEW (id-based) scheme is correctly contained';

  -- ============================================================
  -- Section 2: project-documents, LEGACY (sanitized project_name)
  -- scheme -- reproduces sanitizeStoragePathSegment: non
  -- [a-zA-Z0-9_.-] runs collapse to a single "_".
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', 'ZZ_TEST_180_Project_A/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: a LEGACY-scheme (sanitized project_name) upload for the caller''s own workspace project was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', 'ZZ_TEST_180_Project_B/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to LEGACY-scheme upload into workspace B''s project by sanitized name'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-documents', 'ZZ_TEST_180_Project_Does_Not_Exist/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to LEGACY-scheme upload against a project_name that matches no project at all'; end if;

  raise notice 'TEST PASSED: Section 2 -- project-documents LEGACY (sanitized project_name) scheme is correctly contained';

  -- ============================================================
  -- Section 3: catalog-datasheets, NEW (id-based) scheme.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', catalog_a_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: a NEW-scheme (id-based) upload for the caller''s own workspace catalog item was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', catalog_b_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to NEW-scheme upload into workspace B''s catalog item'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', bogus_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to NEW-scheme upload against a product_catalog id that does not exist at all'; end if;

  raise notice 'TEST PASSED: Section 3 -- catalog-datasheets NEW (id-based) scheme is correctly contained';

  -- ============================================================
  -- Section 4: catalog-datasheets, LEGACY (sanitized catalog_number)
  -- scheme.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', 'ZZ-TEST-180_CAT-A/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: a LEGACY-scheme (sanitized catalog_number) upload for the caller''s own workspace catalog item was rejected'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', 'ZZ-TEST-180_CAT-B/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to LEGACY-scheme upload into workspace B''s catalog item by sanitized catalog_number'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', 'ZZ-TEST-180_CAT-Does-Not-Exist/stamp-legacy.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to LEGACY-scheme upload against a catalog_number that matches no catalog item at all'; end if;

  raise notice 'TEST PASSED: Section 4 -- catalog-datasheets LEGACY (sanitized catalog_number) scheme is correctly contained';

  raise notice 'ALL MIGRATION 180 PROJECT-DOCUMENTS AND CATALOG-DATASHEETS STORAGE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

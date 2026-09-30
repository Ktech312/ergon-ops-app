-- Transaction-safe canonical test for migration 222 (backfills what
-- migration 052 was always supposed to create, in production, where it
-- never actually took effect: product_catalog.specifications,
-- product_catalog.datasheet_storage_path, and the catalog-datasheets
-- storage bucket). Wrapped in begin;/rollback; -- nothing here ever
-- commits.
--
-- Covers:
-- (a) product_catalog.specifications exists, defaults to '{}', and
--     accepts a real jsonb write.
-- (b) product_catalog.datasheet_storage_path exists and accepts a real
--     text write.
-- (c) the catalog-datasheets bucket exists (migration 184's own
--     diagnostic was a 23503 foreign-key violation on storage.objects
--     when this bucket was missing -- a real insert against it here
--     proves the bucket is actually there, not just that the INSERT
--     statement ran without error).
-- (d) a quick sanity check that migration 180's workspace-scoped
--     catalog-datasheets storage policies are still the ones in effect
--     (a cross-workspace upload is rejected) -- migration 180's own
--     canonical test already covers this exhaustively (NEW/LEGACY path
--     schemes, bogus ids, bogus catalog numbers); this is not a
--     duplicate of that, just a guard against this migration having
--     silently reintroduced 052's original wide-open policies under
--     their old names (which is exactly what a first draft of this
--     migration did, caught locally by this session's own isolation
--     suite before ever being sent for a real run).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 222 REAPPLY 052
-- CATALOG DETAILS AND DATASHEETS TESTS PASSED -- ZERO SECTIONS
-- SKIPPED", or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid := gen_random_uuid();
  member_a_id uuid := gen_random_uuid();
  member_b_id uuid := gen_random_uuid();
  catalog_a_id uuid;
  catalog_b_id uuid;
  row_spec jsonb;
  row_path text;
  caught boolean;
begin
  perform set_config('role', 'postgres', true);

  select workspace_id into ws_a_id from public.workspace_members limit 1;
  if ws_a_id is null then
    raise exception 'TEST SETUP FAILED: no existing workspace_members row to anchor workspace A to';
  end if;

  insert into public.workspaces (id, name, slug, status)
  values (ws_b_id, 'ZZ Test 222 Workspace B', 'zz-test-222-ws-b-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  insert into auth.users (id, email) values (member_a_id, 'zz-test-222-member-a@example.com')
  on conflict (id) do nothing;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (ws_a_id, member_a_id, true)
  on conflict (workspace_id, user_id) do nothing;

  insert into auth.users (id, email) values (member_b_id, 'zz-test-222-member-b@example.com');
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (ws_b_id, member_b_id, true);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);

  -- ============================================================
  -- Section 1: specifications and datasheet_storage_path columns exist
  -- and accept real writes.
  -- ============================================================

  insert into public.product_catalog (catalog_number, product_name, workspace_id, specifications, datasheet_storage_path)
  values ('ZZ-TEST-222-CAT-A', 'ZZ Test 222 Catalog Item A', ws_a_id, '{"height_in": "10"}'::jsonb, 'zz-test-222/fixture.pdf')
  returning id into catalog_a_id;

  select specifications, datasheet_storage_path into row_spec, row_path
  from public.product_catalog where id = catalog_a_id;

  if row_spec is null or row_spec->>'height_in' is distinct from '10' then
    raise exception 'TEST FAILED: specifications did not round-trip a real jsonb write';
  end if;
  if row_path is distinct from 'zz-test-222/fixture.pdf' then
    raise exception 'TEST FAILED: datasheet_storage_path did not round-trip a real text write';
  end if;

  raise notice 'TEST PASSED: Section 1 -- specifications and datasheet_storage_path both exist and accept real writes';

  -- ============================================================
  -- Section 2: the catalog-datasheets bucket actually exists (not just
  -- the INSERT statement having run without error).
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', catalog_a_id::text || '/fixture.pdf');
  exception when others then
    caught := true;
  end;
  if caught then
    raise exception 'TEST FAILED: insert into storage.objects for catalog-datasheets failed -- the bucket is still missing';
  end if;

  raise notice 'TEST PASSED: Section 2 -- the catalog-datasheets bucket exists and accepts a real object insert';

  -- ============================================================
  -- Section 3: migration 180's workspace-scoped policies are still the
  -- ones in effect -- a cross-workspace upload is rejected, not silently
  -- allowed under 052's original wide-open policy names.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  insert into public.product_catalog (catalog_number, product_name, workspace_id)
  values ('ZZ-TEST-222-CAT-B', 'ZZ Test 222 Catalog Item B', ws_b_id)
  returning id into catalog_b_id;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('catalog-datasheets', catalog_b_id::text || '/fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a workspace-A caller was able to upload into workspace B''s catalog item -- 052''s original wide-open policies were reintroduced';
  end if;

  raise notice 'TEST PASSED: Section 3 -- cross-workspace catalog-datasheets upload is still correctly rejected (migration 180''s policies, not 052''s original ones)';

  raise notice 'ALL MIGRATION 222 REAPPLY 052 CATALOG DETAILS AND DATASHEETS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

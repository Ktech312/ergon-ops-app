-- Transaction-safe canonical test for migration 169 (Phase 3, Stage 5,
-- fifth migration: sales-quote-images storage bucket containment).
-- Wrapped in begin;/rollback; -- nothing here ever commits. The
-- synthetic second workspace this script creates lives ONLY inside
-- this rolled-back transaction, never a persistent second workspace.
--
-- Section 1 proves the real-world case: a storage.objects insert with
-- NO pre-existing sales_quote_location_images row (the actual upload
-- order this app uses) succeeds -- confirming this migration does NOT
-- repeat migration 161's original chicken-and-egg bug (fixed
-- separately by migration 168). Section 2 proves containment: a
-- workspace-A caller cannot upload into workspace B's quote location,
-- or into a quote location id that does not exist at all.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 169 SALES QUOTE IMAGES
-- STORAGE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  quote_a_id uuid;
  quote_b_id uuid;
  quote_loc_a_id uuid;
  quote_loc_b_id uuid;
  caught boolean;
  path_a text;
  path_b text;
  bogus_loc_id uuid := gen_random_uuid();
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member, then build a synthetic second workspace the same way every
  -- prior Phase 3 test has.
  -- ============================================================

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
    values (ws_b, 'ZZ_TEST_169 Other Workspace', 'zz-test-169-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_169 Site A', 'ZZ_TEST_169 Client A', 'open') returning id into quote_a_id;
  insert into public.sales_quote_locations (quote_id, location_type) values (quote_a_id, 'garage') returning id into quote_loc_a_id;
  path_a := quote_loc_a_id::text || '/stamp-fixture.jpg';

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_169 Site B', 'ZZ_TEST_169 Client B', 'open') returning id into quote_b_id;
  insert into public.sales_quote_locations (quote_id, location_type) values (quote_b_id, 'garage') returning id into quote_loc_b_id;
  path_b := quote_loc_b_id::text || '/stamp-fixture.jpg';

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: a storage.objects insert with NO pre-existing
  -- sales_quote_location_images row must succeed, matching the real
  -- upload-then-insert-row order this app actually uses.
  -- ============================================================

  if exists (select 1 from public.sales_quote_location_images where storage_path = path_a) then
    raise exception 'TEST SETUP FAILED: a sales_quote_location_images row already exists for the fixture path -- test fixture is not isolated';
  end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('sales-quote-images', path_a);
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: uploading an image with no pre-existing sales_quote_location_images row was rejected -- this repeats migration 161''s original bug'; end if;

  raise notice 'TEST PASSED: Section 1 -- a sales-quote-images upload with no pre-existing metadata row succeeds';

  -- ============================================================
  -- Section 2: containment -- a workspace-A caller cannot upload into
  -- workspace B's quote location, or into a quote location id that
  -- does not exist at all. Also confirms the previously fully-open
  -- policy is genuinely gone (a bare bucket_id match would have let
  -- both of these through).
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('sales-quote-images', path_b);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to upload into workspace B''s quote location'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('sales-quote-images', bogus_loc_id::text || '/stamp-fixture.jpg');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to upload against a quote_location_id that does not exist at all'; end if;

  raise notice 'TEST PASSED: Section 2 -- cross-workspace and nonexistent-quote-location uploads are correctly rejected';

  raise notice 'ALL MIGRATION 169 SALES QUOTE IMAGES STORAGE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

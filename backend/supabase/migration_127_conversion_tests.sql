-- Transaction-safe tests for migration 127's create_project_from_quote()
-- RPC. Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users for every authorization check (never fabricates a
-- fake auth.users row, never removes or destructively mutates a real
-- user's real workspace membership -- workspace STATUS is temporarily
-- toggled for the PM fixture in Section 3c/3d, always restored before
-- continuing, and moot regardless since the whole transaction rolls back),
-- but the Sales Quote itself (and its locations/items/BOM lines/images),
-- the collision fixtures, and the synthetic workspace used for the
-- workspace-mismatch tests are synthetic data created fresh inside this
-- same rolled-back transaction, clearly named "ZZ_TEST_..." / "zz-test-..."
-- so none of it can ever be confused with real production data even if
-- something went wrong and this somehow committed.
--
-- REVISION NOTE: the first live run of this script (against the now-applied
-- migration 127) failed with `22P02: malformed array literal` -- every
-- `skipped_names := skipped_names || 'text'` append was ambiguous to
-- Postgres's operator resolution (`||` is also defined for anyarray ||
-- anyarray, so a bare text literal on the right can be parsed as an
-- attempted array literal instead of a single element to append -- exactly
-- what happened with a string containing parens and slashes). Every such
-- append now uses array_append(skipped_names, 'text') instead, which has
-- no such ambiguity. That same run also depended on production containing
-- a real, otherwise-unused auth.users row with zero pre-existing workspace
-- membership (to build a clean "wrong workspace" / "suspended workspace"
-- fixture) -- not guaranteed to exist. The no-membership case (EC007) now
-- uses a transaction-local gen_random_uuid() as the simulated caller
-- instead (never written to auth.users or any other table -- only used as
-- the JWT `sub` claim for a read-only auth.uid() check, so it can never
-- violate a foreign key). The wrong-workspace (EC002) and every-membership-
-- suspended (EC007) cases now reuse the existing PM fixture, temporarily
-- toggling real workspace STATUS (never membership rows) inside this same
-- transaction instead of requiring a second real user at all. Migration 127
-- itself was NOT modified or rerun for this revision -- it is already
-- applied; only this verification script changed. That run reached the
-- real INSERT into public.projects and stopped there, inside the still-open
-- transaction, before the malformed-array error ever fired -- Postgres
-- itself confirms nothing from that attempt persisted: no project row, no
-- project_ref_counters increment, no project channel, and (per the same
-- rollback) no synthetic workspace, temporary role grant, or workspace-
-- status change either. Every one of those was rolled back along with the
-- rest of that run.
--
-- SECOND REVISION NOTE: that same run's real INSERT failed with
-- `42P01: relation "project_ref_counters" does not exist` (or equivalent)
-- -- assign_project_ref() (migration 067, a BEFORE INSERT trigger on
-- projects) has no SET search_path of its own, so it inherited
-- create_project_from_quote()'s empty search_path and its unqualified
-- project_ref_counters reference could not resolve. Migration 128 fixes
-- this (and create_project_channel(), migration 101's AFTER INSERT
-- trigger, the same bug class) -- this script now depends on migration 128
-- being applied too, and Section 4 (fresh conversion) directly proves both
-- fixed triggers actually work under create_project_from_quote()'s own
-- context: a real PRJ-YYYY-NNNN reference and exactly one project channel,
-- not just that the two functions are individually well-formed.
--
-- The authorization check migration 127 actually performs reads ONLY
-- workspace_member_roles (not the legacy app_user_roles table -- see the
-- migration's own header comment on why has_role() is never called), so
-- every PM fixture below is a real member of the SAME workspace as the
-- test quote, with a 'pm' row in workspace_member_roles for that specific
-- membership -- a real member of a DIFFERENT workspace, or a real legacy
-- 'pm' with no matching workspace-side row, must NOT pass. A temporary
-- grant (when no real one already exists) writes BOTH app_user_roles and
-- workspace_member_roles, kept in sync, matching what a real grant through
-- the bridge (migration 124) would do -- never a workspace-only grant that
-- could never occur through the real app.
--
-- Every "should fail" assertion snapshots the row counts/ids it could have
-- affected before and after the call and asserts equality -- catching an
-- exception alone does not prove nothing was written.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 127 CONVERSION TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error (either a "TEST
-- FAILED" exception from a real assertion, or a final "SECTIONS SKIPPED"
-- exception naming what was skipped, or a genuine unexpected SQL error like
-- the malformed-array-literal one this revision fixes). It can never
-- quietly finish as "Success. No rows returned." with something having
-- been skipped.

begin;

do $$
declare
  admin_user_id uuid;
  pm_user_id uuid;
  pm_role_preexisted boolean;
  non_privileged_user_id uuid;
  quote_creator_user_id uuid;
  quote_creator_workspace_id uuid;
  no_membership_caller_id uuid;
  synthetic_workspace_id uuid;
  synthetic_quote_id uuid;
  original_role text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  quote_id uuid;
  quote_site_name text;
  collision_quote_id uuid;
  collision_site_name text;
  collision_project_id uuid;
  unverified_quote_id uuid;
  unverified_quote_site_name text;
  unverified_project_id uuid;

  loc_garage_id uuid;
  loc_lot_id uuid;
  loc_deleted_id uuid;
  garage_project_location_id uuid;
  img1_id uuid;
  img2_id uuid;
  receipt_target_project_id uuid;

  caught boolean;
  caught_sqlstate text;
  result_json jsonb;
  result_json_2 jsonb;
  project_row record;
  project_count_before integer;
  project_count_after integer;
  bom_count integer;
  location_count integer;
  item_count integer;
  scope_count integer;
  garage_mapping jsonb;
  already_copied jsonb;
  collision_snapshot_before jsonb;
  collision_snapshot_after jsonb;
  receipt_snapshot_before jsonb;
  receipt_snapshot_after jsonb;
  channel_count integer;
  current_project_number text;
  search_path_marker text := 'SET search_path TO ' || quote_literal('');
begin
  select current_setting('role') into original_role;

  select user_id into admin_user_id from public.app_admins limit 1;
  select wm.user_id, wm.workspace_id into quote_creator_user_id, quote_creator_workspace_id
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where w.status = 'active'
    limit 1;

  if admin_user_id is null or quote_creator_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user or no active-workspace member found)');
  elsif not exists (
    select 1 from public.workspace_members wm
    where wm.user_id = admin_user_id and wm.workspace_id = quote_creator_workspace_id
  ) then
    -- migration 127 requires EVERY caller, including admin, to resolve a
    -- real active workspace membership matching the quote's own -- if
    -- today's admin isn't a member of the one real workspace, every
    -- section below that calls as admin would fail for a reason unrelated
    -- to what it's testing. Skip clearly rather than let that confuse a
    -- real result.
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (the admin user is not a member of the active workspace used for this test run)');
  else
    -- A real, non-admin, SAME-WORKSPACE PM (or, failing that, a real
    -- non-admin member of that same workspace, temporarily granted 'pm' in
    -- both app_user_roles and workspace_member_roles for the life of this
    -- transaction only) -- proves the "PM alone, without admin" half of
    -- the authorization check, scoped correctly to the quote's own
    -- workspace, not just "has role pm somewhere, legacy-side". This same
    -- fixture is reused for the wrong-workspace/suspended-workspace tests
    -- in Section 3c/3d below -- no second real user is needed for those.
    select wm.user_id into pm_user_id
      from public.workspace_members wm
      join public.workspace_member_roles wmr on wmr.workspace_member_id = wm.id
      where wm.workspace_id = quote_creator_workspace_id
        and wmr.role_key = 'pm'
        and wm.user_id not in (select user_id from public.app_admins)
      limit 1;
    pm_role_preexisted := pm_user_id is not null;
    if pm_user_id is null then
      select wm.user_id into pm_user_id
        from public.workspace_members wm
        where wm.workspace_id = quote_creator_workspace_id
          and wm.user_id not in (select user_id from public.app_admins)
        limit 1;
      if pm_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'pm', false)
          on conflict do nothing;
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select wm.id, 'pm', false from public.workspace_members wm
          where wm.workspace_id = quote_creator_workspace_id and wm.user_id = pm_user_id
          on conflict do nothing;
      end if;
    end if;

    select wm.user_id into non_privileged_user_id
      from public.workspace_members wm
      where wm.workspace_id = quote_creator_workspace_id
        and wm.user_id not in (select user_id from public.app_admins)
        and wm.user_id not in (
          select wm2.user_id from public.workspace_members wm2
          join public.workspace_member_roles wmr2 on wmr2.workspace_member_id = wm2.id
          where wm2.workspace_id = quote_creator_workspace_id and wmr2.role_key = 'pm'
        )
        and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      limit 1;

    -- A transaction-local random UUID -- never written to auth.users or
    -- any other table, only ever used as the JWT `sub` claim for a
    -- read-only auth.uid() check (resolve_caller_workspace_id() only
    -- queries workspace_members by this id, never inserts anything before
    -- rejecting). No dependency on production containing any particular
    -- spare, unused real account -- this can never be skipped.
    no_membership_caller_id := gen_random_uuid();

    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'sections needing a PM user (no non-admin member of the active workspace found to grant a temporary pm role to)');
    end if;

    -- ============================================================
    -- Fixture: one synthetic Sales Quote, clearly named, created as a real
    -- active-workspace member so the workspace_id-derivation trigger
    -- (migration 117) succeeds. Starts as 'open' so Section 1 can test the
    -- non-closed-won rejection before flipping it to closed_won for every
    -- section after.
    -- ============================================================
    quote_site_name := 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10);

    perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    insert into public.sales_quotes (client_name, site_name, status, site_street_address, city, site_state, site_zip)
      values ('ZZ Test Client', quote_site_name, 'open', '456 Quote Ave', 'Springfield', 'IL', '62701')
      returning id into quote_id;

    insert into public.sales_quote_locations (quote_id, location_type, name, address, fli, lpr, people_counting, entries_count, exits_count, levels_count)
      values (quote_id, 'garage', 'ZZ Garage A', '123 Test St', true, false, true, 3, 2, 1)
      returning id into loc_garage_id;
    insert into public.sales_quote_locations (quote_id, location_type, name, fli, lpr, people_counting)
      values (quote_id, 'lot', 'ZZ Lot B', false, true, false)
      returning id into loc_lot_id;
    insert into public.sales_quote_locations (quote_id, location_type, name, deleted_at, deleted_by_email)
      values (quote_id, 'garage', 'ZZ Deleted Garage', now(), 'test@ergon.test')
      returning id into loc_deleted_id;

    insert into public.sales_quote_location_items (quote_location_id, line_type, qty, location_label, accessory_qty)
      values (loc_garage_id, 'sign', 2, 'Entrance', 0);
    insert into public.sales_quote_location_items (quote_location_id, line_type, qty, location_label, accessory_qty)
      values (loc_garage_id, 'camera', 1, 'North wall', 1);
    insert into public.sales_quote_location_items (quote_location_id, line_type, qty, deleted_at, deleted_by_email)
      values (loc_garage_id, 'misc', 1, now(), 'test@ergon.test');
    insert into public.sales_quote_location_items (quote_location_id, line_type, qty)
      values (loc_lot_id, 'sensor', 4);
    insert into public.sales_quote_location_items (quote_location_id, line_type, qty)
      values (loc_lot_id, 'vpu', 1);

    insert into public.sales_quote_bom_lines (quote_id, item_name, qty, notes)
      values (quote_id, 'ZZ Camera Model X', 5, '');
    insert into public.sales_quote_bom_lines (quote_id, item_name, qty, notes)
      values (quote_id, 'ZZ Cable Spool', 2, 'Bring extra');
    insert into public.sales_quote_bom_lines (quote_id, item_name, qty, deleted_at, deleted_by_email)
      values (quote_id, 'ZZ Ghost Item', 1, now(), 'test@ergon.test');

    insert into public.sales_quote_location_images (quote_location_id, image_type, storage_path, file_name)
      values (loc_garage_id, 'photo', 'zz-test/fake-1.jpg', 'fake-1.jpg') returning id into img1_id;
    insert into public.sales_quote_location_images (quote_location_id, image_type, storage_path, file_name)
      values (loc_garage_id, 'photo', 'zz-test/fake-2.jpg', 'fake-2.jpg') returning id into img2_id;

    perform set_config('role', original_role, true);

    -- ============================================================
    -- Section 1: authorization -- a caller who is a real member of the
    -- quote's OWN workspace but neither admin nor pm is rejected, and
    -- creates nothing. (Deliberately same-workspace, so this section tests
    -- ONLY the role check, not workspace ownership -- that's Section 3c.)
    -- ============================================================
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 1 (no same-workspace, non-admin, non-pm user found)');
    else
      select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;

      perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        perform public.create_project_from_quote(quote_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);

      select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;
      if not caught then
        raise exception 'TEST FAILED: a same-workspace caller who is neither admin nor pm should be rejected by create_project_from_quote';
      end if;
      if project_count_before is distinct from project_count_after then
        raise exception 'TEST FAILED: a rejected caller should not have created a project row';
      end if;
      raise notice 'TEST PASSED: same-workspace non-admin/non-pm caller rejected, no project created';
    end if;

    -- ============================================================
    -- Section 2: anon execution rejected at the grant layer.
    -- ============================================================
    select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;
    perform set_config('role', 'anon', true);
    caught := false;
    begin
      perform public.create_project_from_quote(quote_id);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;
    if not caught then
      raise exception 'TEST FAILED: an anon caller should be rejected outright (no EXECUTE grant)';
    end if;
    if project_count_before is distinct from project_count_after then
      raise exception 'TEST FAILED: an anon call should not have created a project row';
    end if;
    raise notice 'TEST PASSED: anon caller rejected at the grant layer';

    -- ============================================================
    -- Section 3a: a quote that isn't Closed - Won is rejected, even for an
    -- admin caller who is otherwise fully entitled (same workspace).
    -- ============================================================
    select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    begin
      perform public.create_project_from_quote(quote_id);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;
    if not caught then
      raise exception 'TEST FAILED: an admin should still be rejected converting a quote that is not Closed - Won';
    end if;
    if project_count_before is distinct from project_count_after then
      raise exception 'TEST FAILED: a rejected non-closed-won conversion should not have created a project row';
    end if;
    raise notice 'TEST PASSED: non-Closed-Won quote rejected even for a same-workspace admin caller';

    -- Flip the quote to Closed - Won for every section from here on.
    update public.sales_quotes set status = 'closed_won' where id = quote_id;

    -- ============================================================
    -- Section 3b: a caller with NO workspace membership at all is
    -- rejected, translated to the stable EC007 code (not left as
    -- resolve_caller_workspace_id()'s own plain, uncoded P0001
    -- exception). Uses a fresh, transaction-local random UUID as the
    -- simulated caller -- never written to any table -- so this section
    -- has no dependency on production containing any particular real
    -- account and can never be skipped.
    -- ============================================================
    select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;
    perform set_config('request.jwt.claims', json_build_object('sub', no_membership_caller_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    caught := false;
    caught_sqlstate := null;
    begin
      perform public.create_project_from_quote(quote_id);
    exception when others then
      caught := true;
      get stacked diagnostics caught_sqlstate = returned_sqlstate;
    end;
    perform set_config('role', original_role, true);
    select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;

    if not caught then
      raise exception 'TEST FAILED: a caller with no workspace membership at all should be rejected';
    end if;
    if caught_sqlstate is distinct from 'EC007' then
      raise exception 'TEST FAILED: expected SQLSTATE EC007 (workspace access unavailable), got %', caught_sqlstate;
    end if;
    if project_count_before is distinct from project_count_after then
      raise exception 'TEST FAILED: a rejected no-membership conversion should not have created a project row';
    end if;
    raise notice 'TEST PASSED: a caller with no workspace membership at all is rejected (SQLSTATE EC007), no project created';

    -- ============================================================
    -- Section 3c/3d: reuses the existing PM fixture (no second real user
    -- needed) to test both "a real PM's own workspace differs from the
    -- quote's" (EC002) and "every one of the PM's workspace memberships is
    -- suspended" (EC007), by temporarily toggling real workspace STATUS
    -- (never membership rows) inside this same rolled-back transaction.
    -- The PM's own real workspace is restored to active before Section 4
    -- runs, since every section from there on needs it active to resolve
    -- correctly -- this matters for the rest of THIS run, independent of
    -- the outer rollback (which undoes it regardless once the script ends).
    -- ============================================================
    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 3c/3d (no pm user available)');
    else
      insert into public.workspaces (name, slug, status)
        values ('ZZ Test Synthetic Workspace', 'zz-test-synthetic-workspace-' || substr(md5(random()::text), 1, 8), 'active')
        returning id into synthetic_workspace_id;
      insert into public.workspace_members (workspace_id, user_id) values (synthetic_workspace_id, pm_user_id);

      -- Suspend the PM's real workspace so their only ACTIVE membership
      -- becomes the synthetic one -- the sales_quotes_guard_workspace_id
      -- trigger (migration 117) stamps whichever workspace the inserting
      -- caller resolves to, so the quote created next permanently belongs
      -- to the synthetic workspace, not the real one.
      update public.workspaces set status = 'suspended' where id = quote_creator_workspace_id;

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_SYNTHETIC_QUOTE_' || substr(md5(random()::text), 1, 10), 'closed_won')
        returning id into synthetic_quote_id;
      perform set_config('role', original_role, true);

      -- Flip back: the PM's real workspace is active again (so it
      -- resolves correctly for the EC002 call below and every section
      -- after), and the synthetic workspace is now suspended -- but the
      -- quote just created still permanently belongs to the synthetic
      -- workspace (workspace_id is immutable once set --
      -- guard_workspace_id_mutation(), migration 117).
      update public.workspaces set status = 'active' where id = quote_creator_workspace_id;
      update public.workspaces set status = 'suspended' where id = synthetic_workspace_id;

      -- EC002: the PM resolves to their own, real, active workspace, but
      -- the quote they're converting belongs to a different one.
      select count(*) into project_count_before from public.projects where source_sales_quote_id = synthetic_quote_id;
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.create_project_from_quote(synthetic_quote_id);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);
      select count(*) into project_count_after from public.projects where source_sales_quote_id = synthetic_quote_id;

      if not caught then
        raise exception 'TEST FAILED: a PM should be rejected converting a quote that belongs to a different workspace than their own';
      end if;
      if caught_sqlstate is distinct from 'EC002' then
        raise exception 'TEST FAILED: expected SQLSTATE EC002 (wrong workspace), got %', caught_sqlstate;
      end if;
      if project_count_before is distinct from project_count_after then
        raise exception 'TEST FAILED: a rejected cross-workspace conversion should not have created a project row';
      end if;
      raise notice 'TEST PASSED: a real PM whose active workspace differs from the quote''s own workspace is rejected (SQLSTATE EC002), no project created';

      -- EC007: suspend every workspace this PM belongs to (their real one,
      -- currently active again, and the synthetic one, currently
      -- suspended) -- zero active memberships, so resolve_caller_
      -- workspace_id() raises its own "not active (suspended)" exception,
      -- caught and translated to EC007.
      update public.workspaces set status = 'suspended' where id = quote_creator_workspace_id;

      select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.create_project_from_quote(quote_id);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);
      select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;

      if not caught then
        raise exception 'TEST FAILED: a caller with every workspace membership suspended should be rejected';
      end if;
      if caught_sqlstate is distinct from 'EC007' then
        raise exception 'TEST FAILED: expected SQLSTATE EC007 (workspace access unavailable), got %', caught_sqlstate;
      end if;
      if project_count_before is distinct from project_count_after then
        raise exception 'TEST FAILED: a rejected suspended-membership conversion should not have created a project row';
      end if;
      raise notice 'TEST PASSED: a caller whose every workspace membership is suspended is rejected (SQLSTATE EC007), no project created';

      -- Restore the PM's real workspace to active before continuing --
      -- Section 4 onward needs it active to resolve correctly for this
      -- same run. (Moot for production either way, since the whole
      -- transaction rolls back at the end regardless.)
      update public.workspaces set status = 'active' where id = quote_creator_workspace_id;
    end if;

    -- ============================================================
    -- Section 4: fresh conversion, called as the PM (not admin) --
    -- verifies the whole structure is created atomically and correctly,
    -- soft-deleted rows are excluded, and every location-item line type
    -- (including camera/vpu, which the pre-127 code silently dropped) is
    -- copied with its location_label/accessory fields intact. This is also
    -- the "same-workspace PM succeeds" case.
    -- ============================================================
    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 4 (no pm user available)');
    else
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_id) into result_json;
      perform set_config('role', original_role, true);

      if (result_json->>'already_existed')::boolean is distinct from false then
        raise exception 'TEST FAILED: fresh conversion should report already_existed = false';
      end if;
      if (result_json->>'structure_verified')::boolean is distinct from true then
        raise exception 'TEST FAILED: a fresh conversion this function itself just created should report structure_verified = true';
      end if;
      if (result_json->>'bom_line_count')::int is distinct from 2 then
        raise exception 'TEST FAILED: expected 2 non-deleted BOM lines, got %', result_json->>'bom_line_count';
      end if;
      if (result_json->>'location_count')::int is distinct from 2 then
        raise exception 'TEST FAILED: expected 2 non-deleted locations, got %', result_json->>'location_count';
      end if;
      if (result_json->>'location_item_count')::int is distinct from 4 then
        raise exception 'TEST FAILED: expected 4 non-deleted location items (sign+camera+sensor+vpu), got %', result_json->>'location_item_count';
      end if;

      select p.* into project_row from public.projects p where p.source_sales_quote_id = quote_id;
      if project_row.project_name is distinct from quote_site_name then
        raise exception 'TEST FAILED: project_name should match the quote''s site_name';
      end if;
      if not exists (select 1 from public.project_conversion_receipts where project_id = project_row.id) then
        raise exception 'TEST FAILED: a freshly-created project should have a project_conversion_receipts row';
      end if;
      if project_row.site_type is distinct from 'Mixed Parking' then
        raise exception 'TEST FAILED: expected site_type Mixed Parking (1 garage + 1 lot), got %', project_row.site_type;
      end if;
      if project_row.camera_count is distinct from 3 then
        raise exception 'TEST FAILED: expected camera_count 3 (garage fli+pc=2, lot lpr=1), got %', project_row.camera_count;
      end if;
      if project_row.site_address is distinct from '456 Quote Ave, Springfield, IL, 62701' then
        raise exception 'TEST FAILED: expected site_address to be the quote''s own address fields joined, got %', project_row.site_address;
      end if;
      if project_row.app_status is distinct from 'Draft' then
        raise exception 'TEST FAILED: expected app_status Draft, got %', project_row.app_status;
      end if;

      select count(*) into scope_count from public.project_scope_of_work where project_id = project_row.id;
      if scope_count is distinct from 1 then
        raise exception 'TEST FAILED: expected exactly one project_scope_of_work row, got %', scope_count;
      end if;

      select count(*) into bom_count from public.project_bom_lines where project_id = project_row.id;
      if bom_count is distinct from 2 then
        raise exception 'TEST FAILED: expected 2 project_bom_lines rows, got %', bom_count;
      end if;
      if not exists (
        select 1 from public.project_bom_lines
        where project_id = project_row.id and item_name = 'ZZ Camera Model X'
          and notes = 'Copied from closed-won quote "' || quote_site_name || '".'
      ) then
        raise exception 'TEST FAILED: a blank BOM line note should fall back to the "Copied from..." text';
      end if;
      if not exists (
        select 1 from public.project_bom_lines
        where project_id = project_row.id and item_name = 'ZZ Cable Spool' and notes = 'Bring extra'
      ) then
        raise exception 'TEST FAILED: a non-blank BOM line note should be preserved as-is';
      end if;
      if exists (select 1 from public.project_bom_lines where project_id = project_row.id and item_name = 'ZZ Ghost Item') then
        raise exception 'TEST FAILED: a soft-deleted BOM line should not have been copied';
      end if;

      select count(*) into location_count from public.project_locations where project_id = project_row.id;
      if location_count is distinct from 2 then
        raise exception 'TEST FAILED: expected 2 project_locations rows, got %', location_count;
      end if;
      if exists (select 1 from public.project_locations where project_id = project_row.id and source_quote_location_id = loc_deleted_id) then
        raise exception 'TEST FAILED: a soft-deleted location should not have been copied';
      end if;
      if not exists (
        select 1 from public.project_locations
        where project_id = project_row.id and source_quote_location_id = loc_garage_id and address = '123 Test St' and fli and people_counting and not lpr
      ) then
        raise exception 'TEST FAILED: the garage location was not copied with the expected fields';
      end if;

      select count(*) into item_count
        from public.project_location_items pli
        join public.project_locations pl on pl.id = pli.project_location_id
        where pl.project_id = project_row.id;
      if item_count is distinct from 4 then
        raise exception 'TEST FAILED: expected 4 project_location_items rows, got %', item_count;
      end if;
      if not exists (
        select 1 from public.project_location_items pli
        join public.project_locations pl on pl.id = pli.project_location_id
        where pl.project_id = project_row.id and pl.source_quote_location_id = loc_garage_id
          and pli.line_type = 'camera' and pli.location_label = 'North wall' and pli.accessory_qty = 1
      ) then
        raise exception 'TEST FAILED: the camera line item (with location_label/accessory_qty) was not copied -- this is the exact bug migration 127 fixes';
      end if;
      if not exists (
        select 1 from public.project_location_items pli
        join public.project_locations pl on pl.id = pli.project_location_id
        where pl.project_id = project_row.id and pl.source_quote_location_id = loc_lot_id and pli.line_type = 'vpu' and pli.qty = 1
      ) then
        raise exception 'TEST FAILED: the vpu line item was not copied -- this is the exact bug migration 127 fixes';
      end if;

      select loc into garage_mapping
        from jsonb_array_elements(result_json->'locations') as loc
        where loc->>'quote_location_id' = loc_garage_id::text;
      if garage_mapping is null then
        raise exception 'TEST FAILED: the returned locations mapping is missing the garage location';
      end if;
      if jsonb_array_length(garage_mapping->'already_copied_quote_image_ids') is distinct from 0 then
        raise exception 'TEST FAILED: a fresh conversion should report zero already-copied photos';
      end if;

      -- ============================================================
      -- Migration 128 coverage: the INSERT trigger chain on projects
      -- (assign_project_ref() -- migration 067 -- and create_project_
      -- channel() -- migration 101) fired correctly under
      -- create_project_from_quote()'s search_path='' context, is pinned to
      -- its own empty search_path (so it can never again silently inherit
      -- an unsafe one from any caller), and is not directly executable by
      -- anon/authenticated -- trigger firing itself, proven by Section 4's
      -- own successful conversion above, needs no such grant.
      -- ============================================================
      if project_row.project_number !~ '^PRJ-\d{4}-\d{4,}$' then
        raise exception 'TEST FAILED: expected project_number in PRJ-YYYY-NNNN format (assign_project_ref trigger), got %', project_row.project_number;
      end if;

      select count(*) into channel_count from public.channels where project_id = project_row.id and type = 'project';
      if channel_count is distinct from 1 then
        raise exception 'TEST FAILED: expected exactly 1 project channel (create_project_channel trigger), got %', channel_count;
      end if;
      if not exists (
        select 1 from public.channels
        where project_id = project_row.id and type = 'project' and name = quote_site_name
      ) then
        raise exception 'TEST FAILED: the project channel does not have the expected project_id/type/name';
      end if;

      if position(search_path_marker in pg_get_functiondef('public.assign_project_ref()'::regprocedure)) = 0 then
        raise exception 'TEST FAILED: assign_project_ref() does not have search_path pinned to an empty string';
      end if;
      if position(search_path_marker in pg_get_functiondef('public.create_project_channel()'::regprocedure)) = 0 then
        raise exception 'TEST FAILED: create_project_channel() does not have search_path pinned to an empty string';
      end if;

      if has_function_privilege('anon', 'public.assign_project_ref()', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.assign_project_ref()', 'EXECUTE')
      then
        raise exception 'TEST FAILED: anon/authenticated should not have direct EXECUTE on assign_project_ref()';
      end if;
      if has_function_privilege('anon', 'public.create_project_channel()', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.create_project_channel()', 'EXECUTE')
      then
        raise exception 'TEST FAILED: anon/authenticated should not have direct EXECUTE on create_project_channel()';
      end if;

      raise notice 'TEST PASSED: fresh conversion (called as a same-workspace PM, not admin) created the full structure atomically and correctly, including camera/vpu items, soft-delete exclusion, a correctly-formatted project reference, and exactly one project channel -- with both trigger functions confirmed pinned to an empty search_path and inaccessible to anon/authenticated directly';

      -- ============================================================
      -- Section 4b: project_conversion_receipts is genuinely
      -- tamper-resistant -- only the database owner and a trusted
      -- service-role connection (the role this script itself runs as,
      -- and Supabase's own service_role) can read or write it. An
      -- ordinary signed-in application user (authenticated) or an
      -- anonymous request (anon) cannot, regardless of PM/admin status
      -- inside the app's own role system -- migration 127 REVOKEs every
      -- privilege on this table from both, on top of enabling row level
      -- security with zero policies.
      --
      -- Because the GRANT itself is revoked (not just RLS alone), every
      -- one of SELECT/INSERT/UPDATE/DELETE by `authenticated` is expected
      -- to fail at the GRANT layer with "permission denied for table
      -- project_conversion_receipts" -- Postgres checks table-level
      -- privileges BEFORE row security policies ever run, so none of
      -- these four statements reach RLS at all.
      -- ============================================================
      if has_table_privilege('anon', 'public.project_conversion_receipts', 'SELECT')
        or has_table_privilege('anon', 'public.project_conversion_receipts', 'INSERT')
        or has_table_privilege('anon', 'public.project_conversion_receipts', 'UPDATE')
        or has_table_privilege('anon', 'public.project_conversion_receipts', 'DELETE')
      then
        raise exception 'TEST FAILED: anon should have zero privileges on project_conversion_receipts';
      end if;
      if has_table_privilege('authenticated', 'public.project_conversion_receipts', 'SELECT')
        or has_table_privilege('authenticated', 'public.project_conversion_receipts', 'INSERT')
        or has_table_privilege('authenticated', 'public.project_conversion_receipts', 'UPDATE')
        or has_table_privilege('authenticated', 'public.project_conversion_receipts', 'DELETE')
      then
        raise exception 'TEST FAILED: authenticated should have zero privileges on project_conversion_receipts';
      end if;
      if exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'project_conversion_receipts'
          and grantee in ('anon', 'authenticated')
      ) then
        raise exception 'TEST FAILED: information_schema.role_table_grants shows a grant to anon/authenticated on project_conversion_receipts';
      end if;
      raise notice 'TEST PASSED: anon and authenticated have zero table-level privileges on project_conversion_receipts (has_table_privilege and information_schema.role_table_grants both confirm)';

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.projects (project_name, app_status) values ('ZZ Test Receipt Target', 'Draft') returning id into receipt_target_project_id;
      perform set_config('role', original_role, true);

      select to_jsonb(r) into receipt_snapshot_before from public.project_conversion_receipts r where r.project_id = project_row.id;

      -- SELECT
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        perform 1 from public.project_conversion_receipts where project_id = project_row.id;
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: an authenticated PM should not be able to SELECT from project_conversion_receipts directly (should be rejected at the grant layer)';
      end if;

      -- INSERT
      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        insert into public.project_conversion_receipts (project_id) values (receipt_target_project_id);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: an authenticated PM should not be able to INSERT a project_conversion_receipts row directly (should be rejected at the grant layer)';
      end if;
      if exists (select 1 from public.project_conversion_receipts where project_id = receipt_target_project_id) then
        raise exception 'TEST FAILED: a forged receipt was actually created via a direct authenticated INSERT';
      end if;

      -- UPDATE
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        update public.project_conversion_receipts set created_at = now() where project_id = project_row.id;
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: an authenticated admin should not be able to UPDATE a project_conversion_receipts row directly (should be rejected at the grant layer)';
      end if;

      -- DELETE
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      begin
        delete from public.project_conversion_receipts where project_id = project_row.id;
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: an authenticated admin should not be able to DELETE a project_conversion_receipts row directly (should be rejected at the grant layer)';
      end if;

      select to_jsonb(r) into receipt_snapshot_after from public.project_conversion_receipts r where r.project_id = project_row.id;
      if receipt_snapshot_before is distinct from receipt_snapshot_after then
        raise exception 'TEST FAILED: the real receipt changed despite every direct authenticated attempt being rejected at the grant layer';
      end if;
      if receipt_snapshot_after is null then
        raise exception 'TEST FAILED: the real receipt is gone -- a direct authenticated DELETE should have been blocked at the grant layer';
      end if;
      raise notice 'TEST PASSED: project_conversion_receipts is inaccessible to authenticated (SELECT/INSERT/UPDATE/DELETE all rejected at the grant layer, not merely by RLS row-visibility) -- confirmed from the elevated role that the real receipt is byte-for-byte unchanged';

      -- ============================================================
      -- Section 5: idempotency -- calling again (as admin this time, to
      -- also prove the admin-alone path) returns the SAME project, creates
      -- no duplicate rows, and still reports structure_verified = true
      -- (this function created it, so it stays verified on every
      -- subsequent call, not just the first).
      -- ============================================================
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_id) into result_json_2;
      perform set_config('role', original_role, true);

      if (result_json_2->>'already_existed')::boolean is distinct from true then
        raise exception 'TEST FAILED: a second conversion of the same quote should report already_existed = true';
      end if;
      if (result_json_2->>'structure_verified')::boolean is distinct from true then
        raise exception 'TEST FAILED: re-converting a project this function itself created should still report structure_verified = true';
      end if;
      if (result_json_2->>'project_id')::uuid is distinct from project_row.id then
        raise exception 'TEST FAILED: a second conversion should return the SAME project id, not create a new one';
      end if;
      select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;
      if project_count_after is distinct from 1 then
        raise exception 'TEST FAILED: idempotent re-conversion created a duplicate project row (count = %)', project_count_after;
      end if;
      select count(*) into bom_count from public.project_bom_lines where project_id = project_row.id;
      if bom_count is distinct from 2 then
        raise exception 'TEST FAILED: idempotent re-conversion duplicated BOM lines (count = %)', bom_count;
      end if;

      -- Retrying creates neither another project reference nor another
      -- channel -- assign_project_ref() only assigns one when
      -- new.project_number is still null (never true on a re-conversion,
      -- since create_project_from_quote() short-circuits to the existing
      -- project row and never INSERTs a second projects row at all), and
      -- create_project_channel()'s own ON CONFLICT (type, project_id) DO
      -- NOTHING makes a second insert attempt a no-op even if it were
      -- somehow re-triggered.
      select project_number into current_project_number from public.projects where id = project_row.id;
      if current_project_number is distinct from project_row.project_number then
        raise exception 'TEST FAILED: idempotent re-conversion changed the project''s reference number (was %, now %)', project_row.project_number, current_project_number;
      end if;
      select count(*) into channel_count from public.channels where project_id = project_row.id and type = 'project';
      if channel_count is distinct from 1 then
        raise exception 'TEST FAILED: idempotent re-conversion created a duplicate project channel (count = %)', channel_count;
      end if;

      raise notice 'TEST PASSED: idempotent re-conversion (called as admin) returned the existing project, created zero duplicate rows (including zero duplicate references or channels), stayed structure_verified';

      -- ============================================================
      -- Section 6: photo-retry-safety -- manually mark one of the garage's
      -- two photos as already copied (simulating a partial prior client-
      -- side run), then call again and confirm the RPC reports exactly
      -- that one photo as already-copied and not the other.
      -- ============================================================
      select (loc->>'project_location_id')::uuid into garage_project_location_id
        from jsonb_array_elements(result_json_2->'locations') as loc
        where loc->>'quote_location_id' = loc_garage_id::text;

      insert into public.project_location_images (project_location_id, image_type, storage_path, source_quote_image_id)
        values (garage_project_location_id, 'photo', 'zz-test-project/fake-1.jpg', img1_id);

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(quote_id) into result_json_2;
      perform set_config('role', original_role, true);

      select loc into garage_mapping
        from jsonb_array_elements(result_json_2->'locations') as loc
        where loc->>'quote_location_id' = loc_garage_id::text;
      already_copied := garage_mapping->'already_copied_quote_image_ids';
      if not (already_copied ? img1_id::text) then
        raise exception 'TEST FAILED: the manually-inserted photo (img1) should be reported as already copied';
      end if;
      if already_copied ? img2_id::text then
        raise exception 'TEST FAILED: the never-copied photo (img2) should NOT be reported as already copied';
      end if;
      if jsonb_array_length(already_copied) is distinct from 1 then
        raise exception 'TEST FAILED: expected exactly one already-copied photo id, got %', jsonb_array_length(already_copied);
      end if;
      raise notice 'TEST PASSED: already_copied_quote_image_ids precisely reflects which photos were already copied, not a coarse per-location flag';
    end if;

    -- ============================================================
    -- Section 7: a project name collision with an unrelated, pre-existing
    -- project raises a clear error instead of silently merging into (and
    -- overwriting) that unrelated project -- the old on_conflict=project_name
    -- upsert behavior this migration replaces.
    -- ============================================================
    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 7/8a (no pm user available)');
    else
      collision_site_name := 'ZZ_TEST_COLLISION_' || substr(md5(random()::text), 1, 10);

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.projects (project_name, app_status) values (collision_site_name, 'Draft') returning id into collision_project_id;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status) values ('ZZ Test Client', collision_site_name, 'closed_won')
        returning id into collision_quote_id;
      perform set_config('role', original_role, true);

      select to_jsonb(p) into collision_snapshot_before from public.projects p where p.id = collision_project_id;

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.create_project_from_quote(collision_quote_id);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);

      select to_jsonb(p) into collision_snapshot_after from public.projects p where p.id = collision_project_id;

      if not caught then
        raise exception 'TEST FAILED: converting a quote whose site name collides with an unrelated existing project should raise, not silently merge';
      end if;
      if caught_sqlstate is distinct from 'EC005' then
        raise exception 'TEST FAILED: expected SQLSTATE EC005 (name collision), got %', caught_sqlstate;
      end if;
      if collision_snapshot_before is distinct from collision_snapshot_after then
        raise exception 'TEST FAILED: the unrelated, pre-existing project was modified by a rejected collision attempt';
      end if;
      if exists (select 1 from public.projects where source_sales_quote_id = collision_quote_id) then
        raise exception 'TEST FAILED: a rejected collision attempt should not have created any project linked to the new quote';
      end if;
      raise notice 'TEST PASSED: project-name collision with an unrelated project is rejected (SQLSTATE EC005), not silently merged';

      -- ============================================================
      -- Section 8a: an existing project NOT created by this function
      -- (simulating one the pre-127 client-side code made) is reported
      -- back as already_existed = true, structure_verified = false --
      -- never silently claimed complete, never auto-repaired.
      -- ============================================================
      unverified_quote_site_name := 'ZZ_TEST_UNVERIFIED_' || substr(md5(random()::text), 1, 10);

      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      insert into public.sales_quotes (client_name, site_name, status) values ('ZZ Test Client', unverified_quote_site_name, 'closed_won')
        returning id into unverified_quote_id;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      -- Deliberately NOT via create_project_from_quote() -- this stands in
      -- for a project the OLD client-side code made, with no
      -- project_conversion_receipts row and (realistically) an incomplete
      -- structure (no BOM lines, no locations at all here).
      insert into public.projects (project_name, app_status, source_sales_quote_id)
        values (unverified_quote_site_name, 'Draft', unverified_quote_id)
        returning id into unverified_project_id;
      perform set_config('role', original_role, true);

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.create_project_from_quote(unverified_quote_id) into result_json;
      perform set_config('role', original_role, true);

      if (result_json->>'already_existed')::boolean is distinct from true then
        raise exception 'TEST FAILED: converting a quote with a pre-existing, non-RPC-created project should report already_existed = true';
      end if;
      if (result_json->>'structure_verified')::boolean is distinct from false then
        raise exception 'TEST FAILED: a pre-existing project with no project_conversion_receipts row should report structure_verified = false, not be claimed complete';
      end if;
      if (result_json->>'project_id')::uuid is distinct from unverified_project_id then
        raise exception 'TEST FAILED: should return the existing project''s own id';
      end if;
      raise notice 'TEST PASSED: a pre-existing, non-RPC-created project is reported already_existed = true, structure_verified = false -- never claimed complete, never repaired';
    end if;

    -- ============================================================
    -- Section 8b: ambiguous active workspace membership is rejected --
    -- a real caller who already has one real active membership, given a
    -- SECOND active membership (in a fresh, throwaway workspace), is
    -- rejected rather than the function guessing which workspace they
    -- meant. Uses quote_creator_user_id -- independent of the pm_user_id
    -- fixture, no special zero-membership fixture needed for this one.
    -- ============================================================
    declare
      ambiguous_workspace_id uuid;
    begin
      insert into public.workspaces (name, slug, status)
        values ('ZZ Test Ambiguous Workspace', 'zz-test-ambiguous-workspace-' || substr(md5(random()::text), 1, 8), 'active')
        returning id into ambiguous_workspace_id;
      insert into public.workspace_members (workspace_id, user_id) values (ambiguous_workspace_id, quote_creator_user_id);

      select count(*) into project_count_before from public.projects where source_sales_quote_id = quote_id;
      perform set_config('request.jwt.claims', json_build_object('sub', quote_creator_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.create_project_from_quote(quote_id);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);
      select count(*) into project_count_after from public.projects where source_sales_quote_id = quote_id;

      if not caught then
        raise exception 'TEST FAILED: a caller with two simultaneous active workspace memberships should be rejected (ambiguous)';
      end if;
      if caught_sqlstate is distinct from 'EC007' then
        raise exception 'TEST FAILED: expected SQLSTATE EC007 (workspace access unavailable), got %', caught_sqlstate;
      end if;
      if project_count_before is distinct from project_count_after then
        raise exception 'TEST FAILED: a rejected ambiguous-membership conversion should not have created a project row';
      end if;
      raise notice 'TEST PASSED: ambiguous active workspace membership is rejected (SQLSTATE EC007), no project created';
    end;

    -- ============================================================
    -- Section 9: structural check -- the unique index the race-safety
    -- guarantee depends on actually exists and is unique (the true
    -- concurrent-transaction race itself can't be safely exercised from a
    -- single session, same reasoning as migration 124's Section 9b).
    -- ============================================================
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'projects'
        and indexname = 'projects_source_sales_quote_id_key'
        and indexdef ilike '%unique index%'
    ) then
      raise exception 'TEST FAILED: projects_source_sales_quote_id_key does not exist as a unique index';
    end if;
    raise notice 'TEST PASSED: projects_source_sales_quote_id_key exists as a unique index (structural verification of the race-safety guarantee)';

    if not pm_role_preexisted and pm_user_id is not null then
      delete from public.workspace_member_roles wmr
        using public.workspace_members wm
        where wmr.workspace_member_id = wm.id and wm.workspace_id = quote_creator_workspace_id
          and wm.user_id = pm_user_id and wmr.role_key = 'pm' and wmr.is_primary = false;
      delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm' and is_primary = false;
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, '; ');
  end if;

  raise notice 'ALL MIGRATION 127 CONVERSION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

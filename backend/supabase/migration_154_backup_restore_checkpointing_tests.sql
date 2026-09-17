-- Transaction-safe tests for migration 154's backup restore
-- checkpointing (D9). Wrapped in begin;/rollback; -- nothing here ever
-- commits. Uses a REAL, already-existing admin user for fixture
-- creation; every run this script creates is synthetic, clearly
-- identified by a fake 'ZZ_TEST_HASH_...' snapshot_hash so it can never
-- collide with a real restore run.
--
-- Requires migrations 134-153 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 154 BACKUP RESTORE
-- CHECKPOINTING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  non_admin_user_id uuid;
  r jsonb;
  run_id_1 uuid;
  section_count integer;
  final_status text;
  caught boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    select wm.user_id into non_admin_user_id
      from public.workspace_members wm
      where wm.user_id not in (select user_id from public.app_admins)
      limit 1;
    if non_admin_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'non-admin authorization section (no real non-admin user found)');
    end if;

    -- Section 1: a fresh run for a brand-new hash creates 6 pending
    -- sections, resumed=false.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_1') into r;
    perform set_config('role', original_role, true);

    if (r ->> 'resumed')::boolean is distinct from false then
      raise exception 'TEST FAILED: a brand-new hash was reported as resumed.';
    end if;
    run_id_1 := (r ->> 'run_id')::uuid;
    if run_id_1 is null then
      raise exception 'TEST FAILED: start_or_resume_restore_run returned no run_id.';
    end if;
    select count(*) into section_count from public.restore_run_sections where restore_run_id = run_id_1;
    if section_count <> 6 then
      raise exception 'TEST FAILED: expected 6 pending sections seeded for a fresh run, got %.', section_count;
    end if;
    if not exists (select 1 from public.restore_runs where id = run_id_1 and status = 'running' and snapshot_hash = 'ZZ_TEST_HASH_1') then
      raise exception 'TEST FAILED: fresh run row does not match expected initial state.';
    end if;

    -- Section 2: update one section to succeeded (no warnings), another
    -- to succeeded with warnings, another to failed.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.update_restore_run_section(run_id_1, 'inventoryItems', 'succeeded', 5, 5, null, null);
    perform public.update_restore_run_section(run_id_1, 'movementsBuildsAllocations', 'succeeded', 3, 3, null, array['Movement m1: project "Ghost" could not be resolved -- saved without it.']);
    perform public.update_restore_run_section(run_id_1, 'deviceRecipes', 'failed', 2, 0, 'Some device recipes could not be saved.', null);
    perform set_config('role', original_role, true);

    if not exists (select 1 from public.restore_run_sections where restore_run_id = run_id_1 and section = 'inventoryItems' and status = 'succeeded' and succeeded_count = 5) then
      raise exception 'TEST FAILED: inventoryItems section update did not persist correctly.';
    end if;
    if not exists (select 1 from public.restore_run_sections where restore_run_id = run_id_1 and section = 'movementsBuildsAllocations' and status = 'succeeded' and warnings is not null and array_length(warnings, 1) = 1) then
      raise exception 'TEST FAILED: movementsBuildsAllocations section warnings did not persist correctly.';
    end if;
    if not exists (select 1 from public.restore_run_sections where restore_run_id = run_id_1 and section = 'deviceRecipes' and status = 'failed' and error = 'Some device recipes could not be saved.') then
      raise exception 'TEST FAILED: deviceRecipes section failure did not persist correctly.';
    end if;

    -- Section 3: a second start_or_resume call for the SAME hash while
    -- the run is still 'running' resumes it -- same run_id, resumed=true,
    -- never creates a duplicate run or re-seeds sections.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_1') into r;
    perform set_config('role', original_role, true);

    if (r ->> 'resumed')::boolean is distinct from true then
      raise exception 'TEST FAILED: a second call for the same in-progress hash was not reported as resumed.';
    end if;
    if (r ->> 'run_id')::uuid <> run_id_1 then
      raise exception 'TEST FAILED: resuming created a new run instead of reusing the existing one.';
    end if;
    select count(*) into section_count from public.restore_runs where snapshot_hash = 'ZZ_TEST_HASH_1';
    if section_count <> 1 then
      raise exception 'TEST FAILED: resuming created a duplicate restore_runs row (found %).', section_count;
    end if;
    -- The already-updated sections from Section 2 must still be intact
    -- after a resume -- this is the whole point of checkpointing.
    if not exists (select 1 from public.restore_run_sections where restore_run_id = run_id_1 and section = 'inventoryItems' and status = 'succeeded') then
      raise exception 'TEST FAILED: resume lost a previously-succeeded section''s status.';
    end if;

    -- Section 4: finish the remaining 3 pending sections, then finalize
    -- -- one section still 'failed' means completed_with_failures, not
    -- completed. "Never report full success while a section failed."
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.update_restore_run_section(run_id_1, 'projectSites', 'skipped_empty', 0, 0, null, null);
    perform public.update_restore_run_section(run_id_1, 'purchaseRequests', 'skipped_empty', 0, 0, null, null);
    perform public.update_restore_run_section(run_id_1, 'projectDocuments', 'skipped_empty', 0, 0, null, null);
    select public.finalize_restore_run(run_id_1) into final_status;
    perform set_config('role', original_role, true);

    if final_status <> 'completed_with_failures' then
      raise exception 'TEST FAILED: expected completed_with_failures (deviceRecipes is still failed), got %.', final_status;
    end if;
    if not exists (select 1 from public.restore_runs where id = run_id_1 and status = 'completed_with_failures' and finished_at is not null) then
      raise exception 'TEST FAILED: finalize did not persist completed_with_failures/finished_at correctly.';
    end if;

    -- Section 5: after 'completed_with_failures', a fresh
    -- start_or_resume for the SAME hash resumes it again (not
    -- 'completed', so eligible for resume per §4) -- fix the last
    -- failing section, finalize again, now genuinely 'completed'.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_1') into r;
    if (r ->> 'resumed')::boolean is distinct from true then
      raise exception 'TEST FAILED: a completed_with_failures run was not offered for resume.';
    end if;
    if not exists (select 1 from public.restore_runs where id = run_id_1 and status = 'running') then
      raise exception 'TEST FAILED: resuming a completed_with_failures run did not set status back to running.';
    end if;
    perform public.update_restore_run_section(run_id_1, 'deviceRecipes', 'succeeded', 2, 2, null, null);
    select public.finalize_restore_run(run_id_1) into final_status;
    perform set_config('role', original_role, true);

    if final_status <> 'completed' then
      raise exception 'TEST FAILED: expected completed once every section is succeeded/skipped_empty, got %.', final_status;
    end if;

    -- Section 6: NOW that the run is genuinely 'completed', a fresh
    -- start_or_resume for the same hash starts a BRAND NEW run, not a
    -- resume -- matches §4 step 2 ("if none exists, or the most recent
    -- one is 'completed', start a brand-new run").
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_1') into r;
    perform set_config('role', original_role, true);

    if (r ->> 'resumed')::boolean is distinct from false then
      raise exception 'TEST FAILED: a fresh start after a completed run was reported as resumed.';
    end if;
    if (r ->> 'run_id')::uuid = run_id_1 then
      raise exception 'TEST FAILED: a fresh start after a completed run reused the old run_id.';
    end if;

    -- Section 7: cancellation -- a running run can be cancelled; a
    -- cancelled run is not a dead end, it resumes like any other
    -- incomplete run.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_2') into r;
    perform public.cancel_restore_run((r ->> 'run_id')::uuid);
    perform set_config('role', original_role, true);

    if not exists (select 1 from public.restore_runs where id = (r ->> 'run_id')::uuid and status = 'cancelled') then
      raise exception 'TEST FAILED: cancel_restore_run did not set status to cancelled.';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_2') into r;
    perform set_config('role', original_role, true);
    if (r ->> 'resumed')::boolean is distinct from true then
      raise exception 'TEST FAILED: a cancelled run was not offered for resume.';
    end if;

    -- Section 7b: "Start over" (p_force_new=true) on a resumable run --
    -- creates a genuinely NEW run even though the old one (from Section
    -- 7, still 'running' after being resumed above) would otherwise be
    -- offered for resume. The old run is left untouched, not deleted or
    -- overwritten -- its history stays queryable.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.start_or_resume_restore_run('ZZ_TEST_HASH_2', true) into r;
    perform set_config('role', original_role, true);

    if (r ->> 'resumed')::boolean is distinct from false then
      raise exception 'TEST FAILED: p_force_new=true was reported as a resume.';
    end if;
    select count(*) into section_count from public.restore_runs where snapshot_hash = 'ZZ_TEST_HASH_2';
    if section_count <> 2 then
      raise exception 'TEST FAILED: expected 2 restore_runs rows for this hash after Start Over (the old one plus the new one), found %.', section_count;
    end if;

    -- Section 8: non-admin cannot start/update/finalize/cancel a run.
    if non_admin_user_id is not null then
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', non_admin_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.start_or_resume_restore_run('ZZ_TEST_HASH_NONADMIN');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a non-admin caller was able to start a restore run.';
      end if;
    end if;
  end if;

  -- Section 9 (checked regardless): grant-layer.
  select has_function_privilege('authenticated', 'public.start_or_resume_restore_run(text, boolean)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on start_or_resume_restore_run.';
  end if;
  select has_function_privilege('anon', 'public.start_or_resume_restore_run(text, boolean)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on start_or_resume_restore_run -- expected none.';
  end if;
  select has_table_privilege('anon', 'public.restore_runs', 'select') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has direct select privilege on restore_runs -- expected admin-only via RLS, no anon grant at all.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 154 BACKUP RESTORE CHECKPOINTING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

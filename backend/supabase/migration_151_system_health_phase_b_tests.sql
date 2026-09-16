-- Transaction-safe tests for migration 151's System Health Phase B
-- (system_health_events, its dedup RPC, admin lifecycle actions, and
-- the retention rollup). Wrapped in begin;/rollback; -- nothing here
-- ever commits. Uses REAL, already-existing users for every
-- authorization check (never fabricates a fake auth.users row); every
-- event/summary row this script creates is synthetic, fresh inside this
-- same rolled-back transaction, clearly named 'ZZ_TEST_...' via its
-- surface/failure_reason_code values so it can never collide with a real
-- health event. Fixture discovery mirrors migration 149's own
-- conventions.
--
-- Requires migrations 134-150 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 151 SYSTEM HEALTH PHASE
-- B TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  non_admin_user_id uuid;
  event_id_1 uuid;
  event_id_1_again uuid;
  event_id_2 uuid;
  event_id_1_reopened uuid;
  row_count integer;
  caught boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  anon_can_read boolean;
  authenticated_can_read boolean;
  summary_count integer;
  detail_count integer;
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
      skipped_names := array_append(skipped_names, 'non-admin authorization sections (no real non-admin user found)');
    end if;

    -- Section 1: fresh event -- a brand-new key creates one row,
    -- occurrence_count=1, status='active'.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_surface', 'zz_test_entity', null, 'ZZ_TEST_reason_one', 'degraded', '{"detail":"first"}'::jsonb, null) into event_id_1;
    perform set_config('role', original_role, true);

    if event_id_1 is null then
      raise exception 'TEST FAILED: record_system_health_event returned null for a valid, fresh event.';
    end if;
    if not exists (
      select 1 from public.system_health_events
      where id = event_id_1 and status = 'active' and occurrence_count = 1
        and surface = 'ZZ_TEST_surface' and failure_reason_code = 'ZZ_TEST_reason_one' and severity = 'degraded'
        and previous_occurrence_id is null
    ) then
      raise exception 'TEST FAILED: fresh event row does not match expected initial state.';
    end if;

    -- Section 2: a second call with the exact same key increments
    -- occurrence_count on the SAME row -- never a new row.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_surface', 'zz_test_entity', null, 'ZZ_TEST_reason_one', 'degraded', '{"detail":"second"}'::jsonb, null) into event_id_1_again;
    perform set_config('role', original_role, true);

    if event_id_1_again <> event_id_1 then
      raise exception 'TEST FAILED: a repeat occurrence of the same key created a new row instead of incrementing the existing one.';
    end if;
    if (select occurrence_count from public.system_health_events where id = event_id_1) <> 2 then
      raise exception 'TEST FAILED: occurrence_count did not increment to 2 on a repeat occurrence.';
    end if;
    if (select safe_detail ->> 'detail' from public.system_health_events where id = event_id_1) <> 'second' then
      raise exception 'TEST FAILED: safe_detail was not updated to the most recent occurrence''s detail.';
    end if;

    -- Section 3: a different failure_reason_code (same surface/entity)
    -- creates an independent second row.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_surface', 'zz_test_entity', null, 'ZZ_TEST_reason_two', 'info', null, null) into event_id_2;
    perform set_config('role', original_role, true);

    if event_id_2 = event_id_1 or event_id_2 is null then
      raise exception 'TEST FAILED: a distinct failure_reason_code did not create an independent row.';
    end if;

    -- Section 4: non-admin cannot acknowledge or resolve.
    if non_admin_user_id is not null then
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', non_admin_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', non_admin_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.acknowledge_system_health_event(event_id_1);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a non-admin caller was able to acknowledge a System Health event.';
      end if;
      if (select status from public.system_health_events where id = event_id_1) <> 'active' then
        raise exception 'TEST FAILED: event status changed despite the rejected non-admin acknowledge attempt.';
      end if;
    end if;

    -- Section 5: admin can acknowledge; acknowledged_by_email is set;
    -- an acknowledged row still dedups a repeat occurrence (the partial
    -- index covers 'active' and 'acknowledged' both).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.acknowledge_system_health_event(event_id_1);
    perform set_config('role', original_role, true);

    if not exists (select 1 from public.system_health_events where id = event_id_1 and status = 'acknowledged' and acknowledged_by_email is not null) then
      raise exception 'TEST FAILED: acknowledge did not set status/acknowledged_by_email correctly.';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.record_system_health_event('ZZ_TEST_surface', 'zz_test_entity', null, 'ZZ_TEST_reason_one', 'degraded', null, null);
    perform set_config('role', original_role, true);

    if (select occurrence_count from public.system_health_events where id = event_id_1) <> 3 then
      raise exception 'TEST FAILED: an acknowledged row did not dedup a repeat occurrence (expected occurrence_count=3).';
    end if;
    if (select status from public.system_health_events where id = event_id_1) <> 'acknowledged' then
      raise exception 'TEST FAILED: a repeat occurrence silently changed an acknowledged row back to active.';
    end if;

    -- Section 6: admin can resolve; resolved_at is set.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.resolve_system_health_event(event_id_1);
    perform set_config('role', original_role, true);

    if not exists (select 1 from public.system_health_events where id = event_id_1 and status = 'resolved' and resolved_at is not null) then
      raise exception 'TEST FAILED: resolve did not set status/resolved_at correctly.';
    end if;

    -- Section 7: a repeat occurrence of a RESOLVED key never reopens the
    -- old row -- it creates a brand-new row, linked via
    -- previous_occurrence_id, since the partial index excludes
    -- 'resolved' rows from the conflict target.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_surface', 'zz_test_entity', null, 'ZZ_TEST_reason_one', 'down', null, null) into event_id_1_reopened;
    perform set_config('role', original_role, true);

    if event_id_1_reopened = event_id_1 or event_id_1_reopened is null then
      raise exception 'TEST FAILED: a repeat occurrence of a resolved key did not create a new row.';
    end if;
    if (select status from public.system_health_events where id = event_id_1) <> 'resolved' then
      raise exception 'TEST FAILED: the original resolved row was silently reopened instead of a new row being created.';
    end if;
    if (select previous_occurrence_id from public.system_health_events where id = event_id_1_reopened) <> event_id_1 then
      raise exception 'TEST FAILED: the new row after a resolved repeat was not linked via previous_occurrence_id.';
    end if;
    if (select occurrence_count from public.system_health_events where id = event_id_1_reopened) <> 1 then
      raise exception 'TEST FAILED: the new row after a resolved repeat did not start at occurrence_count=1.';
    end if;

    -- Section 8: input validation raises for genuine bad input (a caller
    -- bug), same EC001 convention as every other RPC in this repo.
    caught := false;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.record_system_health_event('ZZ_TEST_surface', null, null, 'ZZ_TEST_reason_bad', 'not_a_real_severity', null, null);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    if not caught then
      raise exception 'TEST FAILED: an invalid severity value was accepted instead of raising.';
    end if;

    -- Section 9: roll-up. One resolved-91-days-ago row rolls into the
    -- monthly summary and is deleted from the detail table; the
    -- already-acknowledged/active rows above (of any age) are never
    -- touched by the same call regardless of how old they get, since the
    -- WHERE clause excludes non-resolved status unconditionally --
    -- proven here by backdating event_id_1 (already resolved above) and
    -- confirming the still-active event_id_2 survives the same call.
    update public.system_health_events set resolved_at = now() - interval '91 days' where id = event_id_1;
    update public.system_health_events set first_seen_at = now() - interval '400 days', last_seen_at = now() - interval '400 days' where id = event_id_2;

    perform public.roll_up_system_health_events();

    select count(*) into detail_count from public.system_health_events where id = event_id_1;
    if detail_count <> 0 then
      raise exception 'TEST FAILED: a resolved row older than the cutoff was not removed from the detail table by roll-up.';
    end if;
    select count(*) into summary_count from public.system_health_events_monthly_summary
      where surface = 'ZZ_TEST_surface' and failure_reason_code = 'ZZ_TEST_reason_one' and occurrence_count >= 1;
    if summary_count <> 1 then
      raise exception 'TEST FAILED: roll-up did not create exactly one monthly summary row for the rolled-up key.';
    end if;
    if not exists (select 1 from public.system_health_events where id = event_id_2 and status = 'active') then
      raise exception 'TEST FAILED: roll-up touched a still-active row regardless of its age -- active/acknowledged rows must never be summarized or deleted.';
    end if;
    if not exists (select 1 from public.system_health_events where id = event_id_1_reopened and status = 'active') then
      raise exception 'TEST FAILED: roll-up touched a recently-created active row it should never see.';
    end if;
  end if;

  -- Section 10 (checked regardless): grant-layer.
  select has_function_privilege('authenticated', 'public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on record_system_health_event -- expected authenticated-callable.';
  end if;
  select has_function_privilege('anon', 'public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on record_system_health_event -- expected none.';
  end if;
  select has_function_privilege('authenticated', 'public.acknowledge_system_health_event(uuid)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on acknowledge_system_health_event.';
  end if;
  select has_function_privilege('anon', 'public.resolve_system_health_event(uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on resolve_system_health_event -- expected none.';
  end if;
  select has_table_privilege('anon', 'public.system_health_events', 'select') into anon_can_read;
  if anon_can_read then
    raise exception 'TEST FAILED: anon has direct select privilege on system_health_events -- expected admin-only via RLS, no anon grant at all.';
  end if;
  select has_table_privilege('authenticated', 'public.system_health_events', 'select') into authenticated_can_read;
  if not authenticated_can_read then
    raise exception 'TEST FAILED: authenticated has no select grant on system_health_events -- RLS (admin-only) is supposed to be the restriction, not a missing grant.';
  end if;
  select has_function_privilege('authenticated', 'public.roll_up_system_health_events(timestamptz)', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on roll_up_system_health_events -- expected service-role-only (retention cron), never user-callable.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 151 SYSTEM HEALTH PHASE B TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

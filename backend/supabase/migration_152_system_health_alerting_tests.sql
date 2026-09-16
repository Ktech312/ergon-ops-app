-- Transaction-safe tests for migration 152's System Health alert wiring
-- (record_system_health_event's new jsonb return + alert threshold, and
-- record_system_health_recovery). Wrapped in begin;/rollback; -- nothing
-- here ever commits. Uses REAL, already-existing users for every
-- authorization/admin-email check; every event this script creates is
-- synthetic, clearly named 'ZZ_TEST_...'.
--
-- Requires migrations 134-151 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 152 SYSTEM HEALTH
-- ALERTING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  admin_email text;
  r jsonb;
  event_id_1 uuid;
  event_id_2 uuid;
  admin_emails jsonb;
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
    select email into admin_email from auth.users where id = admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);

    -- Section 1: occurrence 1 -- never alert-worthy.
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason', 'degraded', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'alert_worthy')::boolean is distinct from false then
      raise exception 'TEST FAILED: occurrence 1 was reported alert_worthy.';
    end if;
    event_id_1 := (r ->> 'event_id')::uuid;
    if event_id_1 is null then
      raise exception 'TEST FAILED: record_system_health_event returned no event_id on a valid call.';
    end if;

    -- Section 2: occurrence 2 -- still not alert-worthy (count < 3).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason', 'degraded', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'alert_worthy')::boolean is distinct from false then
      raise exception 'TEST FAILED: occurrence 2 was reported alert_worthy.';
    end if;
    if (r ->> 'event_id')::uuid <> event_id_1 then
      raise exception 'TEST FAILED: occurrence 2 did not increment the same row.';
    end if;

    -- Backdate first_seen_at 10 minutes so occurrence 3 crosses the
    -- 5-minute span requirement without a real wait.
    update public.system_health_events set first_seen_at = now() - interval '10 minutes' where id = event_id_1;

    -- Section 3: occurrence 3, span >= 5 minutes -- alert-worthy, with
    -- the real admin's email in admin_emails.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason', 'degraded', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'alert_worthy')::boolean is distinct from true then
      raise exception 'TEST FAILED: occurrence 3 (span >= 5 min) was NOT reported alert_worthy.';
    end if;
    admin_emails := r -> 'admin_emails';
    if not (admin_emails ? admin_email) then
      raise exception 'TEST FAILED: admin_emails did not include the real admin''s email on the alert-worthy call.';
    end if;
    if not exists (select 1 from public.system_health_events where id = event_id_1 and alerted_at is not null) then
      raise exception 'TEST FAILED: alerted_at was not set on the alert-worthy row.';
    end if;

    -- Section 4: occurrence 4 -- already alerted, suppressed even though
    -- the threshold is still met (one alert per incident).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason', 'degraded', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'alert_worthy')::boolean is distinct from false then
      raise exception 'TEST FAILED: occurrence 4 fired a duplicate alert for the same open incident.';
    end if;

    -- Section 5: a DIFFERENT key, 3 occurrences all within the same
    -- instant (span < 5 minutes) -- never alert-worthy regardless of
    -- occurrence count.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_fast_reason', 'degraded', null, null);
    perform public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_fast_reason', 'degraded', null, null);
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_fast_reason', 'degraded', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'alert_worthy')::boolean is distinct from false then
      raise exception 'TEST FAILED: 3 occurrences within seconds (span < 5 min) fired an alert -- span requirement not enforced.';
    end if;
    event_id_2 := (r ->> 'event_id')::uuid;

    -- Section 6: recovery on the alerted incident -- resolves it and
    -- reports was_alerted=true (a recovery notice should be sent).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_recovery('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason') into r;
    perform set_config('role', original_role, true);
    if (r ->> 'recovered')::boolean is distinct from true then
      raise exception 'TEST FAILED: recovery did not resolve the alerted incident.';
    end if;
    if (r ->> 'was_alerted')::boolean is distinct from true then
      raise exception 'TEST FAILED: recovery did not report was_alerted=true for an incident that WAS alerted.';
    end if;
    if not exists (select 1 from public.system_health_events where id = event_id_1 and status = 'resolved') then
      raise exception 'TEST FAILED: the recovered row is not actually marked resolved.';
    end if;

    -- Section 7: recovery on the never-alerted incident -- resolves it
    -- but reports was_alerted=false (no recovery notice needed).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_recovery('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_fast_reason') into r;
    perform set_config('role', original_role, true);
    if (r ->> 'recovered')::boolean is distinct from true then
      raise exception 'TEST FAILED: recovery did not resolve the never-alerted incident.';
    end if;
    if (r ->> 'was_alerted')::boolean is distinct from false then
      raise exception 'TEST FAILED: recovery reported was_alerted=true for an incident that was never alerted.';
    end if;

    -- Section 8: recovery on a key with no active row at all -- a clean
    -- no-op, never a false claim of recovery.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_recovery('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_never_existed') into r;
    perform set_config('role', original_role, true);
    if (r ->> 'recovered')::boolean is distinct from false then
      raise exception 'TEST FAILED: recovery reported recovered=true for a key with no active row.';
    end if;

    -- Section 9: a fresh occurrence of the recovered key starts a brand
    -- new incident -- occurrence_count=1, alerted_at null again (the
    -- "no intervening success" rule -- resolving genuinely resets it).
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);
    select public.record_system_health_event('ZZ_TEST_alert_surface', 'zz_test_entity', null, 'ZZ_TEST_alert_reason', 'down', null, null) into r;
    perform set_config('role', original_role, true);
    if (r ->> 'event_id')::uuid = event_id_1 then
      raise exception 'TEST FAILED: a post-recovery occurrence reused the old (resolved) row instead of starting a new one.';
    end if;
    if not exists (select 1 from public.system_health_events where id = (r ->> 'event_id')::uuid and occurrence_count = 1 and alerted_at is null and previous_occurrence_id = event_id_1) then
      raise exception 'TEST FAILED: the new post-recovery row does not start fresh (occurrence_count=1, alerted_at null, linked via previous_occurrence_id).';
    end if;
  end if;

  -- Section 10 (checked regardless): grant-layer.
  select has_function_privilege('authenticated', 'public.record_system_health_recovery(text, text, uuid, text)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on record_system_health_recovery.';
  end if;
  select has_function_privilege('anon', 'public.record_system_health_recovery(text, text, uuid, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on record_system_health_recovery -- expected none.';
  end if;
  select has_function_privilege('authenticated', 'public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated lost execute privilege on record_system_health_event after the drop+recreate.';
  end if;
  select has_function_privilege('anon', 'public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on record_system_health_event -- expected none.';
  end if;
  select has_function_privilege('authenticated', 'public.list_admin_emails()', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on list_admin_emails -- expected service-role-only.';
  end if;
  select has_function_privilege('anon', 'public.list_admin_emails()', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on list_admin_emails -- expected service-role-only.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 152 SYSTEM HEALTH ALERTING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

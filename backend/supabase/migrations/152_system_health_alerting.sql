-- System Health Phase B, step 5 (Queue R1 item 1's final piece) --
-- alert wiring, per E's explicit 2026-09-16 decision:
--   "alert all workspace admins after three consecutive failures for the
--   same workspace/component, with no intervening success, where the
--   first and latest failures span at least five minutes. Send one
--   alert per incident, suppress duplicates until recovery, record the
--   alert durably, and record/send a recovery notice after a
--   successful event."
--
-- Design:
--   - occurrence_count/first_seen_at/last_seen_at (migration 151) already
--     give "N consecutive failures with no intervening success" for
--     free: a resolved key always starts a brand-new row at
--     occurrence_count=1 (migration 151 §3's own dedup rule), so an
--     active/acknowledged row's occurrence_count IS the consecutive-
--     failure count since the last recovery.
--   - New alerted_at timestamptz column: null until an alert has fired
--     for this row's current (unresolved) incident; once set, stays set
--     until the row resolves (a fresh row after resolution starts over
--     at null) -- this is the "suppress duplicates until recovery" rule,
--     enforced by the same row/lifecycle migration 151 already built,
--     not a new mechanism.
--   - record_system_health_event's return type changes from a bare uuid
--     to jsonb (event_id + whether this call just crossed the alert
--     threshold + the admin email list to notify) -- Postgres cannot
--     change an existing function's return type via CREATE OR REPLACE,
--     so this migration drops and recreates it. Actually SENDING the
--     email happens in application code (api/_lib/systemHealth.js
--     server-side, api/send-system-health-alert.js for browser-
--     triggered call sites), not in SQL -- this repo has no HTTP-capable
--     Postgres extension confirmed available, and every other email send
--     in this app already goes through api/_lib/mailer.js. The RPC's job
--     is only to durably decide+record "yes, alert" and hand back who to
--     tell; actually sending is the same responsibility split this app
--     already uses everywhere else.
--   - New record_system_health_recovery RPC: called on a SUCCESSFUL
--     event for a key that has a live active/acknowledged row. Resolves
--     it and reports whether an alert had actually fired for it (a
--     recovery notice is only sent if an alert was actually sent --
--     never spam a "recovered" email for an incident nobody was ever
--     told about).
--
-- migration_151_system_health_phase_b_tests.sql is updated (not
-- rewritten) alongside this migration to match record_system_health_
-- event's new jsonb return shape -- every original assertion is
-- unchanged, only the two lines extracting the returned event id.
--
-- Confirm 152 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

alter table public.system_health_events add column if not exists alerted_at timestamptz;

drop function if exists public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid);

create function public.record_system_health_event(
  p_surface text,
  p_entity_type text,
  p_entity_id uuid,
  p_failure_reason_code text,
  p_severity text,
  p_safe_detail jsonb default null,
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_previous_resolved_id uuid;
  v_occurrence_count int;
  v_first_seen_at timestamptz;
  v_last_seen_at timestamptz;
  v_alerted_at timestamptz;
  v_alert_worthy boolean := false;
  v_admin_emails text[];
begin
  if p_surface is null or char_length(btrim(p_surface)) = 0 then
    raise exception 'surface is required.' using errcode = 'EC001';
  end if;
  if p_failure_reason_code is null or char_length(btrim(p_failure_reason_code)) = 0 then
    raise exception 'failure_reason_code is required.' using errcode = 'EC001';
  end if;
  if p_severity not in ('info', 'degraded', 'down') then
    raise exception 'severity must be info, degraded, or down.' using errcode = 'EC001';
  end if;

  begin
    select she.id into v_previous_resolved_id
      from public.system_health_events as she
      where she.surface = p_surface
        and coalesce(she.entity_type, '') = coalesce(p_entity_type, '')
        and coalesce(she.entity_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_entity_id, '00000000-0000-0000-0000-000000000000')
        and she.failure_reason_code = p_failure_reason_code
        and she.status = 'resolved'
      order by she.resolved_at desc nulls last, she.created_at desc
      limit 1;

    insert into public.system_health_events as she (
      workspace_id, surface, entity_type, entity_id, failure_reason_code,
      severity, safe_detail, previous_occurrence_id
    ) values (
      p_workspace_id, p_surface, p_entity_type, p_entity_id, p_failure_reason_code,
      p_severity, p_safe_detail, v_previous_resolved_id
    )
    on conflict (
      surface, (coalesce(entity_type, '')), (coalesce(entity_id, '00000000-0000-0000-0000-000000000000')), failure_reason_code
    ) where status in ('active', 'acknowledged')
    do update set
      occurrence_count = she.occurrence_count + 1,
      last_seen_at = now(),
      safe_detail = coalesce(excluded.safe_detail, she.safe_detail)
    returning she.id, she.occurrence_count, she.first_seen_at, she.last_seen_at, she.alerted_at
      into v_event_id, v_occurrence_count, v_first_seen_at, v_last_seen_at, v_alerted_at;

    -- Alert threshold: >=3 consecutive occurrences (no intervening
    -- success -- see header) spanning >=5 minutes between the first and
    -- latest, and not already alerted for this still-open incident.
    if v_alerted_at is null and v_occurrence_count >= 3 and (v_last_seen_at - v_first_seen_at) >= interval '5 minutes' then
      update public.system_health_events set alerted_at = now() where id = v_event_id;
      v_alert_worthy := true;
      select array_agg(u.email) into v_admin_emails
        from public.app_admins aa join auth.users u on u.id = aa.user_id;
    end if;
  exception when others then
    -- Design doc §10: a failed health-event write must never break the
    -- real operation that triggered it.
    v_event_id := null;
    v_alert_worthy := false;
  end;

  return jsonb_build_object(
    'event_id', v_event_id,
    'alert_worthy', v_alert_worthy,
    'admin_emails', case when v_alert_worthy then coalesce(to_jsonb(v_admin_emails), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) from public;
revoke execute on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) from anon;
grant execute on function public.record_system_health_event(text, text, uuid, text, text, jsonb, uuid) to authenticated;

create or replace function public.record_system_health_recovery(
  p_surface text,
  p_entity_type text,
  p_entity_id uuid,
  p_failure_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_was_alerted boolean;
  v_admin_emails text[];
begin
  begin
    update public.system_health_events as she
      set status = 'resolved', resolved_at = now()
      where she.surface = p_surface
        and coalesce(she.entity_type, '') = coalesce(p_entity_type, '')
        and coalesce(she.entity_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_entity_id, '00000000-0000-0000-0000-000000000000')
        and she.failure_reason_code = p_failure_reason_code
        and she.status in ('active', 'acknowledged')
      returning she.id, (she.alerted_at is not null) into v_event_id, v_was_alerted;

    if v_event_id is not null and coalesce(v_was_alerted, false) then
      select array_agg(u.email) into v_admin_emails
        from public.app_admins aa join auth.users u on u.id = aa.user_id;
    end if;
  exception when others then
    v_event_id := null;
    v_was_alerted := false;
  end;

  return jsonb_build_object(
    'recovered', v_event_id is not null,
    'event_id', v_event_id,
    'was_alerted', coalesce(v_was_alerted, false),
    'admin_emails', case when coalesce(v_was_alerted, false) then coalesce(to_jsonb(v_admin_emails), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.record_system_health_recovery(text, text, uuid, text) from public;
revoke execute on function public.record_system_health_recovery(text, text, uuid, text) from anon;
grant execute on function public.record_system_health_recovery(text, text, uuid, text) to authenticated;

-- Service-role-only helper for api/send-system-health-alert.js: that
-- route deliberately never trusts a client-supplied admin-email list
-- (same "re-derive server-side" discipline api/send-notification-
-- email.js already established) -- but api/rest/v1/ doesn't expose the
-- auth schema, so a plain PostgREST call can't read auth.users the way
-- it can any public.* table. This one small function is the same
-- array_agg join already used inline above, exposed for that route to
-- call directly instead of the GoTrue Admin API's slower one-call-per-
-- user shape.
create or replace function public.list_admin_emails()
returns text[]
language sql
security definer
set search_path = ''
stable
as $$
  select array_agg(u.email) from public.app_admins aa join auth.users u on u.id = aa.user_id;
$$;

revoke all on function public.list_admin_emails() from public, anon, authenticated;

commit;

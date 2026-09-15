-- Diagnostic only (2026-09-14, v5) -- not a migration, nothing here is
-- meant to be kept or reused.
--
-- v4's result is now CONFIRMED: table_owner=postgres, function_owner=
-- postgres (identical), a direct insert under this session's own role
-- succeeded, but get_submittal_by_token()'s own internal insert (same
-- values, same token, called moments later in the same transaction) added
-- zero rows -- and its `exception when others then null;` swallows the
-- real reason. This script isolates the true cause two ways:
--   A. confirms the LIVE, deployed function's actual source really does
--      contain the insert statement and search_path pin migration 143
--      wrote -- ruling out drift (a stale cached definition, or an
--      unexpected overload with a different signature/body actually being
--      invoked instead).
--   B. creates a throwaway probe function with the IDENTICAL properties
--      (security definer, set search_path = '', plpgsql, same insert
--      statement) but WITHOUT any exception-swallowing wrapper, calls it,
--      and catches whatever it raises ONE level up -- so the real
--      SQLSTATE and error message finally surface, instead of being
--      discarded inside an `exception when others then null;` the way the
--      real function's own logging always has been.
--
-- Wrapped in begin;/rollback; -- the throwaway probe function, the
-- fixtures, and every insert all roll back together, nothing commits.
-- Ends by deliberately raising an exception containing every finding, the
-- same guaranteed-visible delivery channel v4 already proved works.

begin;

create or replace function public.zz_diag_143_insert_probe(p_token text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.share_link_views (token, entity_type, entity_id, result)
  values (p_token, 'project_submittal', p_entity_id, 'success');
end;
$$;

do $$
declare
  admin_user_id uuid;
  test_project_id uuid;
  test_submittal_id uuid;
  test_token text := 'ZZ_DIAG_143_V5_' || substr(md5(random()::text), 1, 10);
  -- Built via quote_literal(), not hand-counted quote characters -- the
  -- same established pattern this repo's other tests already use (e.g.
  -- migration 128's search_path-pin check) to avoid exactly the kind of
  -- quote-counting mistake that's easy to make writing this by hand.
  search_path_marker text := 'SET search_path TO ' || quote_literal('');
  live_function_source text;
  live_function_has_insert boolean;
  live_function_has_search_path_pin boolean;
  rows_before integer;
  rows_after integer;
  probe_result text;
  finding_a text;
  finding_b text;
begin
  -- Finding A: does the live function's own source really match what
  -- migration 143 wrote?
  select pg_get_functiondef('public.get_submittal_by_token(text)'::regprocedure) into live_function_source;
  live_function_has_insert := position('insert into public.share_link_views' in live_function_source) > 0;
  live_function_has_search_path_pin := position(search_path_marker in live_function_source) > 0;

  finding_a := format(
    'FINDING A: live get_submittal_by_token() source length=%s chars | contains the expected insert statement=%s | contains an empty search_path pin=%s',
    length(live_function_source), live_function_has_insert, live_function_has_search_path_pin
  );

  select user_id into admin_user_id from public.app_admins limit 1;
  if admin_user_id is null then
    raise exception E'DIAGNOSTIC RESULT V5:\n%\nFINDING B: ABORTED -- no admin user found.', finding_a;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('request.jwt.claim.sub', admin_user_id::text, true);

  insert into public.projects (project_name, customer_name, site_type, app_status)
    values ('ZZ_DIAG_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Diag Client', 'Parking Garage', 'Draft')
    returning id into test_project_id;
  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email)
    values (test_project_id, 1, 'sent', '{}'::jsonb, 'ZZ Diag Client', 'zz-diag@example.com')
    returning id into test_submittal_id;
  insert into public.public_share_tokens (token, entity_type, entity_id, status)
    values (test_token, 'project_submittal', test_submittal_id, 'active');

  select count(*) into rows_before from public.share_link_views where token = test_token;

  -- Finding B: call the throwaway probe (identical shape to the real
  -- function's own insert, no exception swallowing) and capture whatever
  -- it actually raises.
  begin
    perform public.zz_diag_143_insert_probe(test_token, test_submittal_id);
    probe_result := 'the probe insert SUCCEEDED with no error.';
  exception when others then
    probe_result := format('the probe insert FAILED -- SQLSTATE=%s MESSAGE=%s', SQLSTATE, SQLERRM);
  end;

  select count(*) into rows_after from public.share_link_views where token = test_token;

  finding_b := format(
    'FINDING B: %s | share_link_views rows for this token: %s before probe call, %s after.',
    probe_result, rows_before, rows_after
  );

  raise exception E'DIAGNOSTIC RESULT V5:\n%\n%', finding_a, finding_b;
end;
$$;

rollback;

-- Canonical isolation test for migration 221 (Billing/SaaS foundation). Wrapped in
-- begin;/rollback; -- nothing commits regardless of outcome. Run via
-- `node backend/supabase/consolidated_isolation_suite/run_all.mjs` against the full real
-- migration history before ever being sent to E.
--
-- Sections:
--   (a) A brand-new workspace auto-gets a real workspace_billing row (trialing/starter/14-day).
--   (b) plan_allows_module() is safe-by-default: unconfigured plan / no plan / comped all allow
--       everything; a configured plan's real allow-list is enforced once modules_configured=true.
--   (c) is_workspace_billing_blocked(): false for a fresh trial, false for past_due within 7
--       days, true for past_due beyond 7 days, true for an expired trial, true for
--       unpaid/canceled, and -- critically -- false for ALL of those when is_comped=true.
--   (d) Regression: an existing (comped) workspace's ordinary writes are byte-for-byte
--       unaffected -- the whole point of widening is_active_workspace_member()/
--       resolve_caller_workspace_id() additively.
--   (e) A billing-blocked workspace: writes are rejected (both chokepoints), reads still work.
--   (f) set_workspace_module_enabled() rejects enabling a module outside a configured plan's
--       entitlement; allows it when unconfigured, when disabling (never restricted), and when
--       the workspace is comped.
--   (g) process_stripe_webhook_event(): idempotent (same event id twice = one state change),
--       past_due_since set only on the FIRST transition into past_due (not reset by repeat
--       past_due events), cleared on recovery, and a comped workspace is completely immune to
--       webhook-driven state changes.
--   (h) RLS: an ordinary member can read workspace_billing; nobody (not even a workspace admin)
--       can write it directly -- only the SECURITY DEFINER RPC path can.
--   (i) get_my_billing_context() correctly reports is_admin=true for the workspace admin,
--       false for an ordinary member, and -- critically -- still resolves successfully for a
--       BLOCKED workspace (unlike resolve_caller_workspace_id(), which would raise).

begin;

do $$
declare
  ws_new_id uuid;
  ws_comped_id uuid;
  ws_blocked_id uuid;
  ws_configured_plan_id uuid;
  admin_user_id uuid;
  member_user_id uuid;
  non_member_id uuid;
  v_status text;
  v_trial_ends_at timestamptz;
  v_plan_key text;
  v_count int;
  v_result text;
  v_past_due_since_1 timestamptz;
  v_past_due_since_2 timestamptz;
  project_id uuid;
  v_ctx_workspace_id uuid;
  v_ctx_is_admin boolean;
begin
  -- ============================================================
  -- Fixtures
  -- ============================================================
  insert into public.workspaces (name, slug, status) values ('Test WS 221 New', 'test-ws-221-new-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into ws_new_id;

  insert into auth.users (id, email) values (gen_random_uuid(), 'test221-admin@example.com') returning id into admin_user_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test221-member@example.com') returning id into member_user_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test221-nonmember@example.com') returning id into non_member_id;

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_new_id, admin_user_id, true);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_new_id, member_user_id, false);

  -- ============================================================
  -- (a) New workspace auto-provisioning
  -- ============================================================
  select status, trial_ends_at, plan_key into v_status, v_trial_ends_at, v_plan_key
  from public.workspace_billing where workspace_id = ws_new_id;

  if v_status is distinct from 'trialing' then
    raise exception 'TEST FAILED (a): expected status=trialing for a new workspace, found %', v_status;
  end if;
  if v_plan_key is distinct from 'starter' then
    raise exception 'TEST FAILED (a): expected plan_key=starter for a new workspace, found %', v_plan_key;
  end if;
  if v_trial_ends_at is null or v_trial_ends_at <= clock_timestamp() or v_trial_ends_at > clock_timestamp() + interval '15 days' then
    raise exception 'TEST FAILED (a): trial_ends_at not set to a real ~14-day-out timestamp: %', v_trial_ends_at;
  end if;

  -- ============================================================
  -- (b) plan_allows_module() safe-by-default, then a real configured allow-list
  -- ============================================================
  if not public.plan_allows_module(null, 'engineering_requests') then
    raise exception 'TEST FAILED (b): plan_allows_module(null, ...) must default to true';
  end if;
  if not public.plan_allows_module('starter', 'engineering_requests') then
    raise exception 'TEST FAILED (b): an unconfigured plan (modules_configured=false) must allow every module';
  end if;

  insert into public.workspaces (name, slug, status) values ('Test WS 221 Configured', 'test-ws-221-cfg-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into ws_configured_plan_id;
  update public.billing_plans set modules_configured = true where plan_key = 'starter';
  insert into public.plan_modules (plan_key, module_key) values ('starter', 'support')
    on conflict do nothing;
  update public.workspace_billing set plan_key = 'starter' where workspace_id = ws_configured_plan_id;

  if not public.plan_allows_module('starter', 'support') then
    raise exception 'TEST FAILED (b): support should be explicitly allowed for the configured starter plan';
  end if;
  if public.plan_allows_module('starter', 'engineering_requests') then
    raise exception 'TEST FAILED (b): engineering_requests should NOT be allowed for a starter plan configured to include only support';
  end if;
  -- Restore starter to unconfigured so it doesn't affect later sections / other test files
  -- run against this same shared instance.
  delete from public.plan_modules where plan_key = 'starter';
  update public.billing_plans set modules_configured = false where plan_key = 'starter';

  -- ============================================================
  -- (c) is_workspace_billing_blocked() across every real state, plus the comped exemption
  -- ============================================================
  if public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): a fresh 14-day trial must not be blocked';
  end if;

  update public.workspace_billing set status = 'past_due', past_due_since = clock_timestamp() - interval '3 days' where workspace_id = ws_new_id;
  if public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): past_due for only 3 days (within the 7-day grace window) must not be blocked yet';
  end if;

  update public.workspace_billing set past_due_since = clock_timestamp() - interval '8 days' where workspace_id = ws_new_id;
  if not public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): past_due for 8 days (past the 7-day grace window) must be blocked';
  end if;

  update public.workspace_billing set status = 'unpaid', past_due_since = null where workspace_id = ws_new_id;
  if not public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): status=unpaid must be blocked outright';
  end if;

  update public.workspace_billing set status = 'canceled' where workspace_id = ws_new_id;
  if not public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): status=canceled must be blocked outright';
  end if;

  update public.workspace_billing set status = 'trialing', trial_ends_at = clock_timestamp() - interval '1 hour' where workspace_id = ws_new_id;
  if not public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): an expired trial must be blocked';
  end if;

  -- The comped exemption: every one of the above states, with is_comped=true, must NOT block.
  update public.workspace_billing set is_comped = true where workspace_id = ws_new_id;
  if public.is_workspace_billing_blocked(ws_new_id) then
    raise exception 'TEST FAILED (c): is_comped=true must exempt an otherwise-expired-trial workspace';
  end if;

  -- ============================================================
  -- (d) Regression: an existing, comped workspace's ordinary writes are unaffected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.projects (project_name, app_status) values ('ZZ Test 221 Regression Project', 'Draft')
    returning id into project_id;

  set local role postgres;
  select count(*) into v_count from public.projects where id = project_id and workspace_id = ws_new_id;
  if v_count <> 1 then
    raise exception 'TEST FAILED (d): a comped workspace''s admin could not create an ordinary project -- regression in the widened chokepoint';
  end if;

  -- ============================================================
  -- (e) A genuinely blocked (not comped) workspace: writes rejected, reads still fine
  -- ============================================================
  update public.workspace_billing set is_comped = false, status = 'unpaid' where workspace_id = ws_new_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.projects (project_name, app_status) values ('ZZ Test 221 Should Be Blocked', 'Draft');
    raise exception 'TEST FAILED (e): a project insert succeeded for a billing-blocked workspace -- write enforcement is not working';
  exception when others then
    if sqlerrm not like '%billing is not current%' then
      raise exception 'TEST FAILED (e): insert rejected for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- Reads (via is_workspace_member, not the widened chokepoints) must still work.
  select count(*) into v_count from public.projects where id = project_id;
  if v_count <> 1 then
    raise exception 'TEST FAILED (e): a billing-blocked workspace member could not READ an existing project -- should be read-only, not fully locked out';
  end if;

  if public.is_active_workspace_member(ws_new_id) then
    raise exception 'TEST FAILED (e): is_active_workspace_member() must return false for a billing-blocked workspace''s member';
  end if;

  set local role postgres;
  update public.workspace_billing set is_comped = true, status = 'trialing', trial_ends_at = clock_timestamp() + interval '14 days' where workspace_id = ws_new_id;

  -- ============================================================
  -- (f) set_workspace_module_enabled(): entitlement enforcement on enable, never on disable
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_workspace_module_enabled('support', false);
  perform public.set_workspace_module_enabled('support', true);

  set local role postgres;
  if not exists (select 1 from public.workspace_enabled_modules where workspace_id = ws_new_id and module_key = 'support' and enabled = true) then
    raise exception 'TEST FAILED (f): re-enabling support on an unconfigured/comped plan should have succeeded';
  end if;

  -- Now configure a real plan that does NOT include 'engineering_requests', assign it (non-
  -- comped), and confirm enabling that module is rejected.
  update public.billing_plans set modules_configured = true where plan_key = 'starter';
  insert into public.plan_modules (plan_key, module_key) values ('starter', 'support') on conflict do nothing;
  update public.workspace_billing set plan_key = 'starter', is_comped = false where workspace_id = ws_new_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_workspace_module_enabled('engineering_requests', true);
    raise exception 'TEST FAILED (f): enabling a module outside the plan''s entitlement must be rejected';
  exception when others then
    if sqlerrm not like '%plan does not include this module%' then
      raise exception 'TEST FAILED (f): rejected for the wrong reason: %', sqlerrm;
    end if;
  end;
  -- Disabling is never entitlement-restricted, even for a module the plan wouldn't allow.
  perform public.set_workspace_module_enabled('engineering_requests', false);

  set local role postgres;
  delete from public.plan_modules where plan_key = 'starter';
  update public.billing_plans set modules_configured = false where plan_key = 'starter';
  update public.workspace_billing set is_comped = true, plan_key = null where workspace_id = ws_new_id;

  -- ============================================================
  -- (g) process_stripe_webhook_event(): idempotency + past_due_since transition logic +
  -- the comped exemption at the RPC level too.
  -- ============================================================
  update public.workspace_billing set is_comped = false, status = 'active', past_due_since = null where workspace_id = ws_new_id;

  select public.process_stripe_webhook_event(
    'evt_test_221_1', 'customer.subscription.updated', '{}'::jsonb,
    ws_new_id, 'past_due', 'cus_test221', 'sub_test221', null, null
  ) into v_result;
  if v_result <> 'processed' then
    raise exception 'TEST FAILED (g): first webhook delivery should return processed, got %', v_result;
  end if;
  select past_due_since into v_past_due_since_1 from public.workspace_billing where workspace_id = ws_new_id;
  if v_past_due_since_1 is null then
    raise exception 'TEST FAILED (g): past_due_since was not set on first transition into past_due';
  end if;

  -- A second, DIFFERENT event id, same status -- past_due_since must NOT move (still the same
  -- ongoing past_due period, not a new one).
  perform pg_sleep(0.01);
  select public.process_stripe_webhook_event(
    'evt_test_221_2', 'customer.subscription.updated', '{}'::jsonb,
    ws_new_id, 'past_due', 'cus_test221', 'sub_test221', null, null
  ) into v_result;
  select past_due_since into v_past_due_since_2 from public.workspace_billing where workspace_id = ws_new_id;
  if v_past_due_since_2 is distinct from v_past_due_since_1 then
    raise exception 'TEST FAILED (g): past_due_since was reset by a second past_due event -- must only be set on the FIRST transition';
  end if;

  -- The SAME event id delivered again (a real Stripe retry) must be a clean no-op.
  select public.process_stripe_webhook_event(
    'evt_test_221_1', 'customer.subscription.updated', '{}'::jsonb,
    ws_new_id, 'past_due', 'cus_test221', 'sub_test221', null, null
  ) into v_result;
  if v_result <> 'duplicate' then
    raise exception 'TEST FAILED (g): redelivering the same event id must return duplicate, got %', v_result;
  end if;
  select count(*) into v_count from public.stripe_webhook_events where stripe_event_id = 'evt_test_221_1';
  if v_count <> 1 then
    raise exception 'TEST FAILED (g): duplicate delivery must not create a second idempotency row, found %', v_count;
  end if;

  -- Recovery: a payment-succeeded event clears past_due_since and flips status back to active.
  select public.process_stripe_webhook_event(
    'evt_test_221_3', 'customer.subscription.updated', '{}'::jsonb,
    ws_new_id, 'active', 'cus_test221', 'sub_test221', null, null
  ) into v_result;
  select status, past_due_since into v_status, v_past_due_since_1 from public.workspace_billing where workspace_id = ws_new_id;
  if v_status <> 'active' or v_past_due_since_1 is not null then
    raise exception 'TEST FAILED (g): recovery event did not clear past_due_since / restore active status (status=%, past_due_since=%)', v_status, v_past_due_since_1;
  end if;

  -- The comped exemption, enforced at the RPC level: once comped, a webhook must never change
  -- workspace_billing's own state, even though the idempotency row still gets written.
  update public.workspace_billing set is_comped = true where workspace_id = ws_new_id;
  select public.process_stripe_webhook_event(
    'evt_test_221_4', 'customer.subscription.updated', '{}'::jsonb,
    ws_new_id, 'canceled', 'cus_test221', 'sub_test221', null, null
  ) into v_result;
  select status into v_status from public.workspace_billing where workspace_id = ws_new_id;
  if v_status <> 'active' then
    raise exception 'TEST FAILED (g): a webhook was able to change a COMPED workspace''s status (now %) -- Q1.4 exemption violated', v_status;
  end if;
  select count(*) into v_count from public.stripe_webhook_events where stripe_event_id = 'evt_test_221_4';
  if v_count <> 1 then
    raise exception 'TEST FAILED (g): the idempotency row itself should still be written even when the state update is suppressed by is_comped';
  end if;

  -- ============================================================
  -- (h) RLS: an ordinary member can read; nobody can write workspace_billing directly
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', member_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.workspace_billing where workspace_id = ws_new_id;
  if v_count <> 1 then
    raise exception 'TEST FAILED (h): an ordinary workspace member could not read their own workspace_billing row';
  end if;

  -- A non-member of any workspace must not see it at all.
  perform set_config('request.jwt.claims', json_build_object('sub', non_member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.workspace_billing where workspace_id = ws_new_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (h): a non-member could read a workspace they do not belong to -- cross-tenant billing leak';
  end if;

  -- Even the workspace's OWN admin cannot write workspace_billing directly (no INSERT/UPDATE
  -- policy exists at all -- every real mutation goes through process_stripe_webhook_event(),
  -- which only the service role can call).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.workspace_billing set status = 'active' where workspace_id = ws_new_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'TEST FAILED (h): a workspace admin was able to directly UPDATE workspace_billing -- must only be writable via the RPC/webhook path';
  end if;

  -- ============================================================
  -- (i) get_my_billing_context(): correct admin flag, and works even for a blocked workspace
  -- ============================================================
  set local role postgres;
  update public.workspace_billing set is_comped = false, plan_key = null where workspace_id = ws_new_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select workspace_id, is_admin into v_ctx_workspace_id, v_ctx_is_admin from public.get_my_billing_context();
  if v_ctx_workspace_id is distinct from ws_new_id or v_ctx_is_admin is distinct from true then
    raise exception 'TEST FAILED (i): expected (workspace_id=%, is_admin=true) for the real admin, got (%, %)', ws_new_id, v_ctx_workspace_id, v_ctx_is_admin;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', member_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select is_admin into v_ctx_is_admin from public.get_my_billing_context();
  if v_ctx_is_admin is distinct from false then
    raise exception 'TEST FAILED (i): expected is_admin=false for an ordinary member, got %', v_ctx_is_admin;
  end if;

  -- Now genuinely block the workspace and confirm get_my_billing_context() STILL resolves
  -- (unlike resolve_caller_workspace_id(), which would raise) -- this is the entire reason it
  -- exists, so an admin can reach the portal/checkout flow to actually fix a blocked workspace.
  set local role postgres;
  update public.workspace_billing set status = 'unpaid' where workspace_id = ws_new_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select workspace_id into v_ctx_workspace_id from public.get_my_billing_context();
  if v_ctx_workspace_id is distinct from ws_new_id then
    raise exception 'TEST FAILED (i): get_my_billing_context() failed to resolve a BLOCKED workspace -- it must never depend on is_workspace_billing_blocked()';
  end if;

  set local role postgres;
  update public.workspace_billing set is_comped = true, status = 'trialing' where workspace_id = ws_new_id;

  raise notice 'ALL MIGRATION 221 BILLING FOUNDATION TESTS PASSED (a)-(i).';
end $$;

rollback;

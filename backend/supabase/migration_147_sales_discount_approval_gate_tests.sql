-- Transaction-safe tests for migration 147's configurable discount-
-- approval gate. Wrapped in begin;/rollback; -- nothing here ever
-- commits. Uses REAL, already-existing users for every authorization
-- check (never fabricates a fake auth.users row); every quote, proposal,
-- and approval request this script creates is synthetic, fresh inside
-- this same rolled-back transaction, clearly named "ZZ_TEST_...". Fixture
-- discovery, temporary role grants, and the single-role isolation
-- technique for negative checks all mirror migration_140's own test
-- exactly (same app_user_roles-based fixture discovery this migration's
-- own RPCs authorize against, not the newer workspace_member_roles
-- pattern -- see migration 147's header for why).
--
-- Economizes to three real people rather than needing a fourth distinct
-- "manager" account: the discovered Sales user is used first (sales-only,
-- no manager role yet) to create requests and to prove self-approval is
-- denied, then temporarily also granted 'manager' (in addition to their
-- existing 'sales' role -- a real person can hold both) to prove a
-- genuine manager approval succeeds. Restored to their original role set
-- at cleanup either way.
--
-- Requires migrations 134-146 to already be live (the conversion RPC
-- chain and D3's source_quote_ref addition are unrelated to this gate,
-- but sales_quotes.discount_percent from migration 136 is required).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 147 SALES DISCOUNT
-- APPROVAL GATE TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.
--
-- CORRECTED 2026-09-15, TEST SCRIPT ONLY -- migration 147 itself was never
-- touched. E's first live run failed Section 11's second assertion ("an
-- unrelated PM-only caller cannot read someone else's approval request").
-- Root cause: this workspace's real fixture discovery picked a "pm" role
-- holder and a "sales" role holder who turned out to be the SAME real
-- person (holding both roles), because the primary lookup for
-- sales_user_id (below) didn't exclude pm_user_id the way its own
-- fallback path already did. With pm_user_id == sales_user_id, the
-- "unrelated PM" in Section 11 was actually the original requester
-- themselves, so `requested_by = auth.uid()` correctly (and harmlessly)
-- made the row visible to them -- the RLS policy and migration 147's own
-- authorization logic were never wrong. Fixed by excluding pm_user_id
-- from the primary sales_user_id lookup too, guaranteeing two distinct
-- real people the same way the fallback path already did.
--
-- CORRECTED AGAIN 2026-09-15, TEST SCRIPT ONLY, same class of bug --
-- migration 147 still untouched. E's second live run failed Section 7
-- ("the Sales user who created the request was able to approve their own
-- request"). Root cause: with pm/sales now guaranteed distinct, the real
-- Sales person this workspace's fixture discovery found already held
-- 'manager' as a genuine pre-existing secondary role in production
-- (entirely plausible on a small team) -- the header above even said
-- "no manager role yet" without the test ever verifying or enforcing
-- that. respond_to_proposal_approval_request() correctly allowed them
-- through, since has_role('manager') correctly returned true; the
-- assertion's premise was simply false for this real user. Fixed by
-- applying the SAME single-role-isolation technique already used for PM
-- in Section 5 to the Sales user too: capture and strip any pre-existing
-- 'manager' role before Section 7's negative check, then deliberately
-- re-grant it for Section 8's positive check.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  pm_user_id uuid;
  sales_user_id uuid;
  pm_role_preexisted boolean;
  sales_role_preexisted boolean;
  sales_had_manager_role boolean;
  sales_manager_was_primary boolean;
  pm_had_sales_role boolean;
  pm_sales_was_primary boolean;
  pm_had_manager_role boolean;
  pm_manager_was_primary boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  v_workspace_id uuid;
  settings_preexisted boolean;
  original_enabled boolean;
  original_threshold numeric(5,2);

  quote_low_discount_id uuid;
  quote_high_discount_id uuid;
  quote_reject_id uuid;

  result_json jsonb;
  outcome text;
  request_id uuid;
  reject_request_id uuid;
  proposal_count_before integer;
  proposal_count_after integer;
  request_row record;

  caught boolean;
  caught_message text;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  visible_count integer;
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    select ur.user_id into pm_user_id
    from public.app_user_roles ur
    where ur.role_key = 'pm'
      and not exists (select 1 from public.app_admins aa where aa.user_id = ur.user_id)
    limit 1;
    pm_role_preexisted := pm_user_id is not null;
    if pm_user_id is null then
      select wm.user_id into pm_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) limit 1;
      if pm_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'pm', false) on conflict do nothing;
      end if;
    end if;

    select ur.user_id into sales_user_id
    from public.app_user_roles ur
    where ur.role_key = 'sales'
      and not exists (select 1 from public.app_admins aa where aa.user_id = ur.user_id)
      and ur.user_id <> pm_user_id
    limit 1;
    sales_role_preexisted := sales_user_id is not null;
    if sales_user_id is null then
      select wm.user_id into sales_user_id from public.workspace_members wm
        where wm.user_id not in (select user_id from public.app_admins) and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        limit 1;
      if sales_user_id is not null then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (sales_user_id, 'sales', false) on conflict do nothing;
      end if;
    end if;

    if pm_user_id is null or sales_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'all-sections (no real PM/Sales user found or grantable)');
    else
      v_workspace_id := public.active_workspace_id();

      -- Snapshot the real settings row (if any) so this test's own
      -- enable/threshold changes can be restored before rollback --
      -- moot for persistence (everything rolls back regardless) but
      -- keeps the rest of this same transaction's behavior predictable
      -- if more sections are added later that also read these settings.
      select discount_approval_enabled, discount_approval_threshold_percent
        into original_enabled, original_threshold
        from public.workspace_sales_approval_settings where workspace_id = v_workspace_id;
      settings_preexisted := found;

      -- Fixture quotes, created as the admin (real workspace member --
      -- sales_quotes' migration-117 ownership trigger requires one).
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
      perform set_config('role', 'authenticated', true);

      insert into public.sales_quotes (client_name, site_name, status, discount_percent)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_LOW_' || substr(md5(random()::text), 1, 10), 'open', 5)
        returning id into quote_low_discount_id;
      insert into public.sales_quotes (client_name, site_name, status, discount_percent)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_HIGH_' || substr(md5(random()::text), 1, 10), 'open', 25)
        returning id into quote_high_discount_id;
      insert into public.sales_quotes (client_name, site_name, status, discount_percent)
        values ('ZZ Test Client', 'ZZ_TEST_QUOTE_REJECT_' || substr(md5(random()::text), 1, 10), 'open', 25)
        returning id into quote_reject_id;

      perform set_config('role', original_role, true);

      -- Section 1: gate DISABLED (explicitly, regardless of the real
      -- current setting) -- even a high-discount quote sends immediately,
      -- no approval request created.
      update public.workspace_sales_approval_settings
        set discount_approval_enabled = false, discount_approval_threshold_percent = 10
        where workspace_id = v_workspace_id;
      if not found then
        insert into public.workspace_sales_approval_settings (workspace_id, discount_approval_enabled, discount_approval_threshold_percent)
        values (v_workspace_id, false, 10);
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select public.request_or_send_quote_proposal_version(quote_high_discount_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') into result_json;
      perform set_config('role', original_role, true);

      outcome := result_json ->> 'outcome';
      if outcome <> 'sent' then
        raise exception 'TEST FAILED: expected outcome=sent when the gate is disabled, got %.', outcome;
      end if;
      if not exists (select 1 from public.sales_quote_proposals where id = (result_json ->> 'proposal_id')::uuid) then
        raise exception 'TEST FAILED: gate-disabled send did not actually create a real sales_quote_proposals row.';
      end if;

      -- Section 2: enable the gate at a known threshold.
      update public.workspace_sales_approval_settings
        set discount_approval_enabled = true, discount_approval_threshold_percent = 10
        where workspace_id = v_workspace_id;

      -- Section 3: a quote with discount_percent (25) > threshold (10)
      -- now requires approval -- no new proposal row, a pending request
      -- row instead.
      select count(*) into proposal_count_before from public.sales_quote_proposals where quote_id = quote_high_discount_id;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select public.request_or_send_quote_proposal_version(quote_high_discount_id, '{"note":"zz"}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') into result_json;
      perform set_config('role', original_role, true);

      outcome := result_json ->> 'outcome';
      if outcome <> 'pending_approval' then
        raise exception 'TEST FAILED: expected outcome=pending_approval for a 25%% discount above a 10%% threshold, got %.', outcome;
      end if;
      request_id := (result_json ->> 'approval_request_id')::uuid;
      if request_id is null then
        raise exception 'TEST FAILED: pending_approval outcome did not include a real approval_request_id.';
      end if;
      if not exists (select 1 from public.sales_quote_proposal_approval_requests where id = request_id and status = 'pending' and quote_id = quote_high_discount_id) then
        raise exception 'TEST FAILED: no pending sales_quote_proposal_approval_requests row exists for the gated request.';
      end if;

      select count(*) into proposal_count_after from public.sales_quote_proposals where quote_id = quote_high_discount_id;
      if proposal_count_after <> proposal_count_before then
        raise exception 'TEST FAILED: a gated (pending-approval) request still created a real proposal row -- gate did not actually block sending.';
      end if;

      -- Section 4: a quote with discount_percent (5) <= threshold (10)
      -- still sends immediately even with the gate enabled.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select public.request_or_send_quote_proposal_version(quote_low_discount_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') into result_json;
      perform set_config('role', original_role, true);

      outcome := result_json ->> 'outcome';
      if outcome <> 'sent' then
        raise exception 'TEST FAILED: expected outcome=sent for a 5%% discount at or below a 10%% threshold, got %.', outcome;
      end if;

      -- Section 5: PM cannot call request_or_send_quote_proposal_version
      -- at all -- isolate PM to a single role first (a real PM may also
      -- carry Sales/Manager as a secondary role, either of which would
      -- correctly authorize this and invalidate the assertion), same
      -- technique migration 140's own test uses.
      pm_had_sales_role := exists (select 1 from public.app_user_roles where user_id = pm_user_id and role_key = 'sales');
      select coalesce((select is_primary from public.app_user_roles where user_id = pm_user_id and role_key = 'sales'), false) into pm_sales_was_primary;
      pm_had_manager_role := exists (select 1 from public.app_user_roles where user_id = pm_user_id and role_key = 'manager');
      select coalesce((select is_primary from public.app_user_roles where user_id = pm_user_id and role_key = 'manager'), false) into pm_manager_was_primary;
      delete from public.app_user_roles where user_id = pm_user_id and role_key in ('sales', 'manager');

      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.request_or_send_quote_proposal_version(quote_low_discount_id, '{}'::jsonb, 'ZZ', 'zz@example.com');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only caller was able to call request_or_send_quote_proposal_version -- PM has no proposal-sending authority per the existing (unchanged) rule.';
      end if;

      -- Section 6: PM cannot approve or reject the pending request either.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.respond_to_proposal_approval_request(request_id, 'approved', null);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only caller was able to approve a proposal-send request -- PM has no approval authority per D4.';
      end if;
      if not exists (select 1 from public.sales_quote_proposal_approval_requests where id = request_id and status = 'pending') then
        raise exception 'TEST FAILED: the request''s status changed despite the rejected PM approval attempt.';
      end if;

      -- Isolate Sales to a single role BEFORE Section 7's negative check
      -- -- a real Sales person may already separately hold 'manager' in
      -- production (entirely plausible on a small team), which would
      -- correctly allow self-approval and invalidate the assertion below
      -- if left in place. Strip it first, same single-role-isolation
      -- technique already used for PM above; restored at cleanup either
      -- way, and re-granted deliberately just below for Section 8.
      sales_had_manager_role := exists (select 1 from public.app_user_roles where user_id = sales_user_id and role_key = 'manager');
      select coalesce((select is_primary from public.app_user_roles where user_id = sales_user_id and role_key = 'manager'), false) into sales_manager_was_primary;
      delete from public.app_user_roles where user_id = sales_user_id and role_key = 'manager';

      -- Section 7: the Sales user who MADE the request cannot approve
      -- their own request either -- isolated to 'sales' only, above.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.respond_to_proposal_approval_request(request_id, 'approved', null);
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: the Sales user who created the request was able to approve their own request -- Sales alone must never satisfy the approval check.';
      end if;

      -- Section 8: a genuine Sales Manager approves -- re-grant 'manager'
      -- to the same Sales user (stripped just above for Section 7's
      -- isolation -- a real person can hold both 'sales' and 'manager')
      -- and confirm the approval actually sends the ORIGINALLY-submitted
      -- content.
      insert into public.app_user_roles (user_id, role_key, is_primary) values (sales_user_id, 'manager', false) on conflict do nothing;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select public.respond_to_proposal_approval_request(request_id, 'approved', 'zz approved for test') into result_json;
      perform set_config('role', original_role, true);

      outcome := result_json ->> 'outcome';
      if outcome <> 'approved' then
        raise exception 'TEST FAILED: expected outcome=approved from a genuine manager''s review, got %.', outcome;
      end if;
      if not exists (
        select 1 from public.sales_quote_proposals
        where id = (result_json ->> 'proposal_id')::uuid and quote_id = quote_high_discount_id
          and content_snapshot = '{"note":"zz"}'::jsonb
      ) then
        raise exception 'TEST FAILED: the approved proposal was not created with the originally-submitted content_snapshot.';
      end if;
      select * into request_row from public.sales_quote_proposal_approval_requests where id = request_id;
      if request_row.status <> 'approved' or request_row.resulting_proposal_id is null or request_row.reviewed_by_email is null or request_row.reviewed_at is null then
        raise exception 'TEST FAILED: the approved request row is missing expected status/resulting_proposal_id/reviewed_by_email/reviewed_at.';
      end if;

      -- Section 9: a manager can also REJECT a request -- no proposal is
      -- ever created for it.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select public.request_or_send_quote_proposal_version(quote_reject_id, '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com') into result_json;
      if (result_json ->> 'outcome') <> 'pending_approval' then
        raise exception 'TEST FAILED: Section 9 setup expected outcome=pending_approval for the reject-flow quote, got %.', result_json ->> 'outcome';
      end if;
      reject_request_id := (result_json ->> 'approval_request_id')::uuid;

      select public.respond_to_proposal_approval_request(reject_request_id, 'rejected', 'zz rejected for test') into result_json;
      perform set_config('role', original_role, true);

      outcome := result_json ->> 'outcome';
      if outcome <> 'rejected' then
        raise exception 'TEST FAILED: expected outcome=rejected, got %.', outcome;
      end if;
      if exists (select 1 from public.sales_quote_proposals where quote_id = quote_reject_id) then
        raise exception 'TEST FAILED: a rejected approval request still resulted in a real proposal being created.';
      end if;
      if not exists (select 1 from public.sales_quote_proposal_approval_requests where id = reject_request_id and status = 'rejected' and resulting_proposal_id is null) then
        raise exception 'TEST FAILED: the rejected request row does not show status=rejected with no resulting_proposal_id.';
      end if;

      -- Section 10: an already-resolved request cannot be reviewed again
      -- -- no duplicate proposal, no state change, a clear rejection.
      caught := false;
      caught_message := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.respond_to_proposal_approval_request(request_id, 'approved', 'zz double review');
      exception when others then
        caught := true;
        get stacked diagnostics caught_message = message_text;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: an already-approved request was reviewed a second time without error.';
      end if;
      select count(*) into proposal_count_after from public.sales_quote_proposals where quote_id = quote_high_discount_id;
      if proposal_count_after <> proposal_count_before + 1 then
        raise exception 'TEST FAILED: re-reviewing an already-resolved request created an extra proposal (expected exactly one from Section 8).';
      end if;

      -- Section 11: RLS read visibility -- the requester (Sales) can read
      -- their own request; an unrelated PM-only caller cannot.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into visible_count from public.sales_quote_proposal_approval_requests where id = request_id;
      perform set_config('role', original_role, true);
      if visible_count <> 1 then
        raise exception 'TEST FAILED: the requester could not read their own approval request row.';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into visible_count from public.sales_quote_proposal_approval_requests where id = request_id;
      perform set_config('role', original_role, true);
      if visible_count <> 0 then
        raise exception 'TEST FAILED: an unrelated PM-only, non-requester, non-manager caller could read someone else''s approval request row.';
      end if;

      -- Restore role state exactly as found.
      if not sales_had_manager_role then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'manager';
      else
        update public.app_user_roles set is_primary = sales_manager_was_primary where user_id = sales_user_id and role_key = 'manager';
      end if;
      if pm_had_sales_role then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'sales', pm_sales_was_primary)
          on conflict (user_id, role_key) do update set is_primary = excluded.is_primary;
      end if;
      if pm_had_manager_role then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'manager', pm_manager_was_primary)
          on conflict (user_id, role_key) do update set is_primary = excluded.is_primary;
      end if;

      -- Restore the real settings row to what it was before this test
      -- touched it -- moot for persistence (rollback handles that), kept
      -- for predictability if this script is ever extended further.
      if settings_preexisted then
        update public.workspace_sales_approval_settings
          set discount_approval_enabled = original_enabled, discount_approval_threshold_percent = original_threshold
          where workspace_id = v_workspace_id;
      end if;

      if not pm_role_preexisted and pm_user_id is not null then
        delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm';
      end if;
      if not sales_role_preexisted and sales_user_id is not null then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'sales';
      end if;
    end if;
  end if;

  -- Section 12 (checked regardless): grant-layer bypass closure.
  select has_function_privilege('authenticated', 'public.create_and_send_quote_proposal_version(uuid, jsonb, text, text)', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated still has direct execute privilege on create_and_send_quote_proposal_version -- the gated wrapper''s bypass-closure did not take effect.';
  end if;
  select has_function_privilege('authenticated', 'public.request_or_send_quote_proposal_version(uuid, jsonb, text, text)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on request_or_send_quote_proposal_version -- expected authenticated-only.';
  end if;
  select has_function_privilege('authenticated', 'public.respond_to_proposal_approval_request(uuid, text, text)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on respond_to_proposal_approval_request -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.request_or_send_quote_proposal_version(uuid, jsonb, text, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on request_or_send_quote_proposal_version -- expected none.';
  end if;
  select has_function_privilege('anon', 'public.respond_to_proposal_approval_request(uuid, text, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on respond_to_proposal_approval_request -- expected none.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 147 SALES DISCOUNT APPROVAL GATE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

-- Transaction-safe tests for migration 148's optional BOM line items
-- (D17). Wrapped in begin;/rollback; -- nothing here ever commits. Uses
-- a REAL, already-existing admin user for fixture creation (never
-- fabricates a fake auth.users row); every quote/proposal/token this
-- script creates is synthetic, fresh inside this same rolled-back
-- transaction, clearly named "ZZ_TEST_...".
--
-- This script does NOT re-run migration 139's own full coverage of
-- respond_to_quote_proposal (invalid/expired/superseded/unavailable
-- token handling, the already_responded branch's core mechanics, the
-- completed-document retention transition, the quote_proposal_responded
-- notification) -- all of that logic is preserved byte-for-byte by
-- migration 148 and stays covered by migration_139_share_link_
-- lifecycle_actions_tests.sql. This script focuses on exactly what 148
-- changes: the new is_optional column, the new
-- p_selected_optional_line_ids parameter, the server-computed final_*
-- totals, and their immutability after response.
--
-- content_snapshot fixtures are hand-built JSON, not real
-- sales_quote_bom_lines rows -- respond_to_quote_proposal only ever
-- reads the frozen snapshot, never the live BOM table, so this is a
-- faithful test of its actual behavior; a separate section confirms the
-- is_optional COLUMN itself (default, read-back) directly against a real
-- row, independent of the proposal-response flow.
--
-- Requires migrations 134-147 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 148 OPTIONAL BOM LINES
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  admin_email text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  line_required_id uuid := gen_random_uuid();
  line_optional_a_id uuid := gen_random_uuid();
  line_optional_b_id uuid := gen_random_uuid();
  snapshot_with_pricing jsonb;
  snapshot_without_pricing jsonb;

  quote_id_1 uuid;
  proposal_id_1 uuid;
  token_1 text;

  quote_id_2 uuid;
  proposal_id_2 uuid;
  token_2 text;

  bom_line_id uuid;
  bom_line_is_optional boolean;

  r record;
  send_result jsonb;
  caught boolean;
  old_signature_still_exists boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    -- created_by_email has no default and no trigger -- a real Sales
    -- Quote row only gets it because the frontend passes the signed-in
    -- user's email explicitly at creation. Fixture quotes need to set it
    -- too, or the regression check below (Section 1) would find no
    -- owner to notify through no fault of migration 148's own,
    -- unmodified notification logic. Read while still at original_role
    -- (the SQL editor's own connection), like every other real-user
    -- lookup in this script -- 'authenticated' has no direct grant to
    -- query auth.users, only a SECURITY DEFINER function's own bypassed
    -- context does.
    select email into admin_email from auth.users where id = admin_user_id;

    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform set_config('role', 'authenticated', true);

    -- Section 0: the is_optional column itself -- default false, reads
    -- back correctly -- independent of the proposal-response flow.
    insert into public.sales_quotes (client_name, site_name, status, created_by_email, created_by_user_id)
      values ('ZZ Test Client', 'ZZ_TEST_OPTLINES_' || substr(md5(random()::text), 1, 10), 'open', admin_email, admin_user_id)
      returning id into quote_id_1;
    insert into public.sales_quote_bom_lines (quote_id, item_name, qty)
      values (quote_id_1, 'ZZ Test Line', 1)
      returning id, is_optional into bom_line_id, bom_line_is_optional;
    if bom_line_is_optional is distinct from false then
      raise exception 'TEST FAILED: sales_quote_bom_lines.is_optional did not default to false.';
    end if;
    update public.sales_quote_bom_lines set is_optional = true where id = bom_line_id;
    select is_optional into bom_line_is_optional from public.sales_quote_bom_lines where id = bom_line_id;
    if bom_line_is_optional is distinct from true then
      raise exception 'TEST FAILED: sales_quote_bom_lines.is_optional did not read back true after being set.';
    end if;

    -- Fixture 1: a priced snapshot (post-migration-136 shape) with one
    -- required line ($100) and two optional lines ($50 each), 10%
    -- discount, 5% tax -- deliberately NOT read from real BOM rows (see
    -- header) so this exercises exactly what a real frontend send would
    -- freeze once it's updated to include id/isOptional per line.
    snapshot_with_pricing := jsonb_build_object(
      'clientName', 'ZZ Test Client',
      'siteName', 'ZZ Test Site',
      'bom', jsonb_build_array(
        jsonb_build_object('id', line_required_id::text, 'item', 'Required Line', 'qty', 1, 'unitPrice', 100, 'isOptional', false, 'lineTotal', 100),
        jsonb_build_object('id', line_optional_a_id::text, 'item', 'Optional A', 'qty', 1, 'unitPrice', 50, 'isOptional', true, 'lineTotal', 50),
        jsonb_build_object('id', line_optional_b_id::text, 'item', 'Optional B', 'qty', 1, 'unitPrice', 50, 'isOptional', true, 'lineTotal', 50)
      ),
      'subtotal', 200, 'discountPercent', 10, 'discountAmount', 20,
      'taxRate', 5, 'taxAmount', 9, 'grandTotal', 189
    );

    -- Migration 144 dropped sales_quote_proposals' direct-write policy
    -- entirely, and migration 147 additionally revoked authenticated's
    -- direct EXECUTE on create_and_send_quote_proposal_version itself --
    -- request_or_send_quote_proposal_version() (migration 147) is now
    -- the only authenticated-callable entry point, exactly what a real
    -- Create & Send does. These fixture quotes carry no discount_percent
    -- (defaults to 0), so the discount-approval gate can never apply
    -- regardless of its current enabled/threshold settings, guaranteeing
    -- outcome=sent every time. It returns jsonb, not a table.
    select public.request_or_send_quote_proposal_version(quote_id_1, snapshot_with_pricing, 'ZZ Test Client', 'zz-test@example.com') into send_result;
    if send_result ->> 'outcome' <> 'sent' then
      raise exception 'TEST FAILED: fixture setup expected outcome=sent creating proposal 1, got %.', send_result ->> 'outcome';
    end if;
    proposal_id_1 := (send_result ->> 'proposal_id')::uuid;
    token_1 := send_result ->> 'token';

    -- Fixture 2: a snapshot with no pricing fields at all -- simulates a
    -- proposal sent before migration 136 existed.
    snapshot_without_pricing := jsonb_build_object(
      'clientName', 'ZZ Test Client',
      'siteName', 'ZZ Test Site',
      'bom', jsonb_build_array(
        jsonb_build_object('item', 'Pre-pricing Line', 'qty', 1)
      )
    );
    insert into public.sales_quotes (client_name, site_name, status, created_by_email, created_by_user_id)
      values ('ZZ Test Client', 'ZZ_TEST_OPTLINES_OLD_' || substr(md5(random()::text), 1, 10), 'open', admin_email, admin_user_id)
      returning id into quote_id_2;
    select public.request_or_send_quote_proposal_version(quote_id_2, snapshot_without_pricing, 'ZZ Test Client', 'zz-test@example.com') into send_result;
    if send_result ->> 'outcome' <> 'sent' then
      raise exception 'TEST FAILED: fixture setup expected outcome=sent creating proposal 2, got %.', send_result ->> 'outcome';
    end if;
    proposal_id_2 := (send_result ->> 'proposal_id')::uuid;
    token_2 := send_result ->> 'token';

    perform set_config('role', original_role, true);

    -- Section 1: responding with only Optional A selected -- required
    -- ($100) + Optional A ($50) = $150 subtotal; 10% discount = $15;
    -- taxable $135, 5% tax = $6.75; grand total $141.75. Optional B
    -- excluded entirely from every figure.
    select * into r from public.respond_to_quote_proposal(
      token_1, 'approved', 'ZZ Approver', '127.0.0.1', 'looks good',
      array[line_optional_a_id]
    );
    if r.outcome <> 'success' then
      raise exception 'TEST FAILED: expected outcome=success responding with one optional line selected, got %.', r.outcome;
    end if;

    if (select selected_optional_line_ids from public.sales_quote_proposals where id = proposal_id_1)
        is distinct from array[line_optional_a_id] then
      raise exception 'TEST FAILED: selected_optional_line_ids does not match what was submitted.';
    end if;
    if (select final_subtotal from public.sales_quote_proposals where id = proposal_id_1) is distinct from 150.00 then
      raise exception 'TEST FAILED: final_subtotal expected 150.00 (required + one optional line), got %.', (select final_subtotal from public.sales_quote_proposals where id = proposal_id_1);
    end if;
    if (select final_discount_amount from public.sales_quote_proposals where id = proposal_id_1) is distinct from 15.00 then
      raise exception 'TEST FAILED: final_discount_amount expected 15.00, got %.', (select final_discount_amount from public.sales_quote_proposals where id = proposal_id_1);
    end if;
    if (select final_tax_amount from public.sales_quote_proposals where id = proposal_id_1) is distinct from 6.75 then
      raise exception 'TEST FAILED: final_tax_amount expected 6.75, got %.', (select final_tax_amount from public.sales_quote_proposals where id = proposal_id_1);
    end if;
    if (select final_grand_total from public.sales_quote_proposals where id = proposal_id_1) is distinct from 141.75 then
      raise exception 'TEST FAILED: final_grand_total expected 141.75, got %.', (select final_grand_total from public.sales_quote_proposals where id = proposal_id_1);
    end if;

    -- Regression check: the existing quote_proposal_responded
    -- notification still fires, unaffected by this migration's changes.
    if not exists (
      select 1 from public.notifications
      where related_entity_type = 'sales_quote_proposal' and related_entity_id = proposal_id_1::text
        and event_type = 'quote_proposal_responded'
    ) then
      raise exception 'TEST FAILED: the pre-existing quote_proposal_responded notification did not fire -- this migration should not have touched that logic.';
    end if;

    -- Section 2: immutability -- a second response attempt (even
    -- selecting different lines) must be rejected as already_responded
    -- and must NOT change any previously-stored selection/totals. A new
    -- proposal version is the only way to change this, exactly as
    -- decided.
    select * into r from public.respond_to_quote_proposal(
      token_1, 'rejected', 'ZZ Someone Else', '127.0.0.1', 'changed my mind',
      array[line_optional_b_id]
    );
    if r.outcome <> 'already_responded' then
      raise exception 'TEST FAILED: expected outcome=already_responded on a second response attempt, got %.', r.outcome;
    end if;
    if (select final_subtotal from public.sales_quote_proposals where id = proposal_id_1) is distinct from 150.00 then
      raise exception 'TEST FAILED: a second response attempt changed final_subtotal -- the selection must be immutable after response.';
    end if;
    if (select selected_optional_line_ids from public.sales_quote_proposals where id = proposal_id_1)
        is distinct from array[line_optional_a_id] then
      raise exception 'TEST FAILED: a second response attempt changed selected_optional_line_ids -- the selection must be immutable after response.';
    end if;

    -- Section 3: a proposal sent before pricing existed -- final totals
    -- are left NULL, never guessed, exactly like subtotal/grandTotal
    -- themselves already behave on ProposalSnapshot.
    select * into r from public.respond_to_quote_proposal(
      token_2, 'approved', 'ZZ Approver', '127.0.0.1', '', array[]::uuid[]
    );
    if r.outcome <> 'success' then
      raise exception 'TEST FAILED: expected outcome=success for the pre-pricing snapshot response, got %.', r.outcome;
    end if;
    if (select final_subtotal from public.sales_quote_proposals where id = proposal_id_2) is not null then
      raise exception 'TEST FAILED: final_subtotal should be NULL for a snapshot with no pricing fields, got %.', (select final_subtotal from public.sales_quote_proposals where id = proposal_id_2);
    end if;
    if (select final_grand_total from public.sales_quote_proposals where id = proposal_id_2) is not null then
      raise exception 'TEST FAILED: final_grand_total should be NULL for a snapshot with no pricing fields.';
    end if;

    -- Section 4: an oversized selection array is rejected outright.
    caught := false;
    begin
      perform public.respond_to_quote_proposal(
        'ZZ_DOES_NOT_MATTER', 'approved', 'ZZ', '127.0.0.1', '',
        (select array_agg(gen_random_uuid()) from generate_series(1, 201))
      );
    exception when others then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: an oversized selected_optional_line_ids array was not rejected.';
    end if;
  end if;

  -- Section 5 (checked regardless): grant-layer -- the new 6-arg
  -- signature is anon-only, and the old 5-arg signature genuinely no
  -- longer exists (confirms the DROP, not just that a new overload was
  -- added alongside it).
  select to_regprocedure('public.respond_to_quote_proposal(text, text, text, text, text)') is not null into old_signature_still_exists;
  if old_signature_still_exists then
    raise exception 'TEST FAILED: the old 5-argument respond_to_quote_proposal signature still exists -- expected it to have been dropped.';
  end if;
  select has_function_privilege('anon', 'public.respond_to_quote_proposal(text, text, text, text, text, uuid[])', 'execute') into anon_can_execute;
  if not anon_can_execute then
    raise exception 'TEST FAILED: anon does not have execute privilege on the new respond_to_quote_proposal signature -- expected anon-only.';
  end if;
  select has_function_privilege('authenticated', 'public.respond_to_quote_proposal(text, text, text, text, text, uuid[])', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on respond_to_quote_proposal -- expected anon-only, unchanged from before this migration.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 148 OPTIONAL BOM LINES TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

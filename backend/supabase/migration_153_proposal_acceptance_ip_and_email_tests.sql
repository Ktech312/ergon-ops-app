-- Transaction-safe tests for migration 153's proposal acceptance
-- hardening (D12 revised): approval_email set from the proposal's own
-- client_email, approval_ip stores whatever the (now server-only)
-- caller passes, and the anon direct-call grant is closed. Wrapped in
-- begin;/rollback; -- nothing here ever commits. Uses a REAL,
-- already-existing admin user for fixture creation; every quote/
-- proposal/token this script creates is synthetic, clearly named
-- "ZZ_TEST_...".
--
-- This script does NOT re-run migration 148/139's own full coverage of
-- respond_to_quote_proposal (D17 optional-line totals, invalid/expired/
-- superseded/unavailable token handling, already_responded, the
-- completed-document retention transition, the notification) -- all of
-- that logic is preserved byte-for-byte by this migration and stays
-- covered by those two scripts. This script focuses on exactly what 153
-- changes: approval_email, and the grant closure. Since anon can no
-- longer call this function at all (the whole point of this migration),
-- this script calls it at original_role throughout, the same way this
-- repo's other tests already call an authenticated-or-service-role-only
-- function directly -- the grant-layer check at the end is what actually
-- proves anon is locked out, not the absence of an anon-role call here.
--
-- Requires migrations 134-152 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 153 PROPOSAL ACCEPTANCE
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

  snapshot jsonb;
  quote_id_1 uuid;
  proposal_id_1 uuid;
  token_1 text;
  send_result jsonb;
  r record;

  recorded_approval_email text;
  recorded_approval_ip text;
  recorded_approval_hash text;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
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

    snapshot := jsonb_build_object(
      'clientName', 'ZZ Test Client',
      'siteName', 'ZZ Test Site',
      'bom', jsonb_build_array(jsonb_build_object('item', 'Line', 'qty', 1))
    );

    insert into public.sales_quotes (client_name, site_name, status, created_by_email, created_by_user_id)
      values ('ZZ Test Client', 'ZZ_TEST_ACCEPT_' || substr(md5(random()::text), 1, 10), 'open', admin_email, admin_user_id)
      returning id into quote_id_1;

    -- The proposal's own recipient email -- this, not any parameter to
    -- respond_to_quote_proposal, is what approval_email must end up as.
    select public.request_or_send_quote_proposal_version(quote_id_1, snapshot, 'ZZ Test Client', 'zz-test-recipient@example.com') into send_result;
    if send_result ->> 'outcome' <> 'sent' then
      raise exception 'TEST FAILED: fixture setup expected outcome=sent, got %.', send_result ->> 'outcome';
    end if;
    proposal_id_1 := (send_result ->> 'proposal_id')::uuid;
    token_1 := send_result ->> 'token';

    perform set_config('role', original_role, true);

    -- Section 1: respond with a server-observed IP (what the new API
    -- route would pass) -- approval_ip stores it verbatim, approval_email
    -- comes from the proposal's own client_email, never from a
    -- parameter (there is no email parameter to this function at all).
    select * into r from public.respond_to_quote_proposal(token_1, 'approved', 'ZZ Client Typed Name', '203.0.113.42', 'Looks good.');
    if r.outcome <> 'success' then
      raise exception 'TEST FAILED: expected outcome=success, got %.', r.outcome;
    end if;

    select approval_email, approval_ip, approval_content_hash
    into recorded_approval_email, recorded_approval_ip, recorded_approval_hash
    from public.sales_quote_proposals where id = proposal_id_1;

    if recorded_approval_email is distinct from 'zz-test-recipient@example.com' then
      raise exception 'TEST FAILED: approval_email was not set from the proposal''s own client_email (got %).', recorded_approval_email;
    end if;
    if recorded_approval_ip is distinct from '203.0.113.42' then
      raise exception 'TEST FAILED: approval_ip did not store the passed value (got %).', recorded_approval_ip;
    end if;
    if recorded_approval_hash is null or char_length(recorded_approval_hash) <> 64 then
      raise exception 'TEST FAILED: approval_content_hash was not preserved (untouched by this migration, should still be a 64-char sha256 hex digest).';
    end if;

    -- Section 2: the frozen snapshot/hash/audit trail this migration is
    -- explicitly told to preserve -- confirm the hash still matches a
    -- fresh computation of the frozen content_snapshot, proving the
    -- hash logic itself was carried over unchanged.
    if not exists (
      select 1 from public.sales_quote_proposals
      where id = proposal_id_1 and approval_content_hash = encode(sha256(content_snapshot::text::bytea), 'hex')
    ) then
      raise exception 'TEST FAILED: approval_content_hash does not match a fresh hash of the frozen content_snapshot.';
    end if;
  end if;

  -- Section 3 (checked regardless): grant-layer -- anon's direct-call
  -- access is closed by this migration; this is the actual proof anon
  -- can no longer reach this function at all, not just that this
  -- script chose not to call it as anon above.
  select has_function_privilege('anon', 'public.respond_to_quote_proposal(text, text, text, text, text, uuid[])', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon still has execute privilege on respond_to_quote_proposal -- this migration is supposed to close that.';
  end if;
  select has_function_privilege('authenticated', 'public.respond_to_quote_proposal(text, text, text, text, text, uuid[])', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on respond_to_quote_proposal -- expected service-role-only.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 153 PROPOSAL ACCEPTANCE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

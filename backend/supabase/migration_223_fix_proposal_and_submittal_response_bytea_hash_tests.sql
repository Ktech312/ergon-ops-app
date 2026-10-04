-- Transaction-safe canonical test for migration 223 (respond_to_quote_proposal
-- and respond_to_submittal stop crashing with 22P02 "invalid input syntax for
-- type bytea" when the frozen content_snapshot contains a backslash). Wrapped
-- in begin;/rollback; -- nothing here ever commits.
--
-- Covers:
-- (a) A Sales proposal whose snapshot contains a double quote (so its JSON
--     text contains a backslash) can be approved -- before 223 this raised
--     22P02 and the client saw "Could not submit your response."
-- (b) approval_content_hash is a 64-char sha256 digest of the snapshot's UTF-8
--     bytes (convert_to), i.e. exactly what the old expression produced for
--     every backslash-free snapshot.
-- (c) A backslash-free snapshot still hashes to the same value the old
--     ::bytea expression gave (no behavioural change for what already worked).
-- (d) A project submittal whose snapshot contains a double quote can be
--     approved too.
--
-- A production-acceptance run of this script ends in exactly one of two ways:
-- the final notice reading "ALL MIGRATION 223 BYTEA HASH FIX TESTS PASSED --
-- ZERO SECTIONS SKIPPED", or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  admin_email text;
  snapshot_q jsonb;
  snapshot_plain jsonb;
  quote_id_1 uuid;
  quote_id_2 uuid;
  proposal_id_1 uuid;
  proposal_id_2 uuid;
  token_1 text;
  token_2 text;
  send_result jsonb;
  r record;
  recorded_hash text;
  project_id_1 uuid;
  submittal_id_1 uuid;
  token_sub text := encode(gen_random_bytes(16), 'hex');
begin
  select current_setting('role') into original_role;
  select user_id into admin_user_id from public.app_admins limit 1;
  if admin_user_id is null then
    raise exception 'TEST SETUP FAILED: no app_admins row to act as';
  end if;
  select email into admin_email from auth.users where id = admin_user_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: snapshot WITH a double quote (=> backslash in its JSON text).
  -- ============================================================
  snapshot_q := jsonb_build_object(
    'clientName', 'ZZ Test 223 Client',
    'bom', jsonb_build_array(jsonb_build_object('item', '55" Display Kiosk', 'qty', 1, 'description', '<span class="x">hi</span>'))
  );
  if position(E'\\' in snapshot_q::text) = 0 then
    raise exception 'TEST SETUP FAILED: the quote-bearing snapshot was expected to contain a backslash in its JSON text';
  end if;

  insert into public.sales_quotes (client_name, site_name, status, created_by_email, created_by_user_id)
    values ('ZZ Test 223 Client', 'ZZ_TEST_223_' || substr(md5(random()::text), 1, 10), 'open', admin_email, admin_user_id)
    returning id into quote_id_1;
  select public.request_or_send_quote_proposal_version(quote_id_1, snapshot_q, 'ZZ Test 223 Client', 'zz-test-223@example.invalid') into send_result;
  if send_result ->> 'outcome' <> 'sent' then
    raise exception 'TEST SETUP FAILED: expected outcome=sent, got %', send_result ->> 'outcome';
  end if;
  proposal_id_1 := (send_result ->> 'proposal_id')::uuid;
  token_1 := send_result ->> 'token';

  perform set_config('role', original_role, true);

  select * into r from public.respond_to_quote_proposal(token_1, 'approved', 'ZZ Client', '203.0.113.7', 'ok');
  if r.outcome <> 'success' then
    raise exception 'TEST FAILED (a): approving a proposal whose snapshot contains a quote should succeed, got outcome=%', r.outcome;
  end if;

  select approval_content_hash into recorded_hash from public.sales_quote_proposals where id = proposal_id_1;
  if recorded_hash is null or char_length(recorded_hash) <> 64 then
    raise exception 'TEST FAILED (b): approval_content_hash should be a 64-char digest, got %', recorded_hash;
  end if;
  if recorded_hash is distinct from encode(sha256(convert_to((select content_snapshot::text from public.sales_quote_proposals where id = proposal_id_1), 'UTF8')), 'hex') then
    raise exception 'TEST FAILED (b): approval_content_hash is not the sha256 of the snapshot''s UTF-8 bytes';
  end if;
  raise notice 'TEST PASSED: Section 1 -- a snapshot containing a double quote can be approved and hashes to the sha256 of its UTF-8 bytes';

  -- ============================================================
  -- Section 2: backslash-free snapshot hashes exactly as the old expression did.
  -- ============================================================
  perform set_config('role', 'authenticated', true);
  snapshot_plain := jsonb_build_object('clientName', 'ZZ Test 223 Plain', 'bom', jsonb_build_array(jsonb_build_object('item', 'Plain Line', 'qty', 1)));
  insert into public.sales_quotes (client_name, site_name, status, created_by_email, created_by_user_id)
    values ('ZZ Test 223 Plain', 'ZZ_TEST_223P_' || substr(md5(random()::text), 1, 10), 'open', admin_email, admin_user_id)
    returning id into quote_id_2;
  select public.request_or_send_quote_proposal_version(quote_id_2, snapshot_plain, 'ZZ Test 223 Plain', 'zz-test-223p@example.invalid') into send_result;
  proposal_id_2 := (send_result ->> 'proposal_id')::uuid;
  token_2 := send_result ->> 'token';
  perform set_config('role', original_role, true);

  select * into r from public.respond_to_quote_proposal(token_2, 'revision_requested', 'ZZ Client', '203.0.113.8', 'please change');
  if r.outcome <> 'success' then
    raise exception 'TEST FAILED (c): revision request on a plain snapshot should succeed, got outcome=%', r.outcome;
  end if;
  if not exists (
    select 1 from public.sales_quote_proposals
    where id = proposal_id_2 and approval_content_hash = encode(sha256(content_snapshot::text::bytea), 'hex')
  ) then
    raise exception 'TEST FAILED (c): for a backslash-free snapshot the new hash must equal the old ::bytea hash';
  end if;
  raise notice 'TEST PASSED: Section 2 -- backslash-free snapshots hash identically to before (no behaviour change for what already worked)';

  -- ============================================================
  -- Section 3: submittal whose snapshot contains a double quote.
  -- ============================================================
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name, customer_name) values ('ZZ_TEST_223 Project', 'ZZ_TEST_223 Customer')
    returning id into project_id_1;
  perform set_config('role', 'postgres', true);
  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email, sent_at)
    values (project_id_1, 1, 'sent', jsonb_build_object('item', '48" Delineator'), 'ZZ_TEST_223 Client', 'zz-test-223-sub@example.invalid', now())
    returning id into submittal_id_1;
  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
    values (token_sub, 'project_submittal', submittal_id_1, now() + interval '30 days');
  perform set_config('role', original_role, true);

  select * into r from public.respond_to_submittal(token_sub, 'approved', 'ZZ Client', '203.0.113.9', null);
  if r.outcome <> 'success' then
    raise exception 'TEST FAILED (d): approving a submittal whose snapshot contains a quote should succeed, got outcome=%', r.outcome;
  end if;
  select approval_content_hash into recorded_hash from public.project_submittals where id = submittal_id_1;
  if recorded_hash is null or char_length(recorded_hash) <> 64 then
    raise exception 'TEST FAILED (d): submittal approval_content_hash should be a 64-char digest, got %', recorded_hash;
  end if;
  raise notice 'TEST PASSED: Section 3 -- a submittal whose snapshot contains a double quote can be approved';

  raise notice 'ALL MIGRATION 223 BYTEA HASH FIX TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

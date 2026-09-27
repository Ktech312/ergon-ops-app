-- Transaction-safe canonical test for migration 220 (marketing_leads /
-- marketing_lead_activity / convert_marketing_lead_to_quote()). Wrapped
-- in begin;/rollback; -- nothing here ever commits. Two fully synthetic
-- workspaces so cross-workspace isolation can be proven directly rather
-- than assumed.
--
-- Covers:
-- (a) An active workspace member can create a lead and read it back.
-- (b) A different workspace's member cannot read or write it.
-- (c) Logging activity against a lead works; an invalid activity kind is
--     rejected by the check constraint.
-- (d) Only a 'qualified' lead can be converted -- a 'new' lead is
--     rejected.
-- (e) Converting a qualified lead: creates a new clients row (none
--     existed), creates the sales_quotes row with the right fields
--     carried over, flips the lead to 'converted' recording
--     converted_by/converted_at/client_id, and logs one activity row --
--     all atomically.
-- (f) Converting a second lead for a company that ALREADY has a clients
--     row (case-insensitive match) reuses it rather than creating a
--     duplicate -- the "without re-entry" dedup the design doc requires.
-- (g) Cross-workspace: workspace B's member cannot convert workspace A's
--     lead, even with its exact id.
-- (h) The external_source/external_id dedup index is workspace-scoped --
--     the same (source, id) pair is fine in two different workspaces,
--     rejected as a duplicate within the same one.
-- (i) No delete policy exists -- a DELETE attempt is a silent no-op (0
--     rows affected), matching this schema's established discipline for
--     core lifecycle entities with no delete path.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 220 MARKETING LEADS
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  member_a_id uuid := gen_random_uuid();
  member_b_id uuid := gen_random_uuid();
  member_a_email text := 'zz-test-220-member-a@example.com';
  lead_id uuid;
  lead_row record;
  activity_row record;
  quote_row record;
  client_count integer;
  row_count integer;
  affected_rows integer;
  caught boolean;
  second_lead_id uuid;
  second_client_id uuid;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 220 Workspace A', 'zz-test-220-ws-a', 'active') returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 220 Workspace B', 'zz-test-220-ws-b', 'active') returning id into ws_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (member_a_id, member_a_email, now()),
    (member_b_id, 'zz-test-220-member-b@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (ws_a_id, member_a_id, false),
    (ws_b_id, member_b_id, false);

  -- ============================================================
  -- Section (a): create a lead, read it back.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.marketing_leads (company_name, contact_name, contact_email, lead_source)
  values ('ZZ Test 220 Acme Corp', 'Jane Doe', 'jane@acme.example', 'website_form')
  returning id into lead_id;

  select count(*) into row_count from public.marketing_leads where id = lead_id and company_name = 'ZZ Test 220 Acme Corp';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace member could not create and read back a lead';
  end if;

  raise notice 'TEST PASSED: Section (a) -- an active workspace member can create a lead and read it back';

  -- ============================================================
  -- Section (b): a different workspace's member cannot read or write it.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.marketing_leads where id = lead_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace B''s member could read workspace A''s lead';
  end if;

  begin
    update public.marketing_leads set status = 'qualifying' where id = lead_id;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.marketing_leads where id = lead_id and status = 'qualifying';
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace B''s member could update workspace A''s lead';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a different workspace''s member cannot read or write another workspace''s lead';

  -- ============================================================
  -- Section (c): activity logging works; invalid kind rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.add_marketing_lead_activity(lead_id, 'contact_attempt', 'Left a voicemail.');

  select count(*) into row_count from public.marketing_lead_activity where marketing_lead_id = lead_id and kind = 'contact_attempt' and actor_email = member_a_email;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace member could not log activity against their own lead, or actor_email was not resolved server-side';
  end if;

  caught := false;
  begin
    perform public.add_marketing_lead_activity(lead_id, 'not_a_real_kind', 'x');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an invalid activity kind was accepted';
  end if;

  caught := false;
  begin
    insert into public.marketing_lead_activity (marketing_lead_id, kind, actor_email) values (lead_id, 'note', 'someone-else@example.com');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a direct INSERT bypassing add_marketing_lead_activity() was accepted -- actor_email could be spoofed';
  end if;

  raise notice 'TEST PASSED: Section (c) -- activity logging works with server-resolved actor_email; an invalid kind is rejected; direct INSERT (which could spoof actor_email) is blocked';

  -- ============================================================
  -- Section (d): only a qualified lead can be converted.
  -- ============================================================

  caught := false;
  begin
    perform public.convert_marketing_lead_to_quote(lead_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a lead with status ''new'' was allowed to convert';
  end if;

  raise notice 'TEST PASSED: Section (d) -- only a qualified lead can be converted';

  -- ============================================================
  -- Section (e): converting a qualified lead -- new client, new quote,
  -- lead flipped to converted with who/when, one activity row logged.
  -- ============================================================

  update public.marketing_leads set status = 'qualified' where id = lead_id;

  select count(*) into client_count from public.clients where workspace_id = ws_a_id and name = 'ZZ Test 220 Acme Corp';
  if client_count is distinct from 0 then
    raise exception 'TEST SETUP INVARIANT VIOLATED: a clients row for this company already existed before conversion';
  end if;

  select * into quote_row from public.convert_marketing_lead_to_quote(lead_id);

  if quote_row.client_name is distinct from 'ZZ Test 220 Acme Corp' or quote_row.contact_full_name is distinct from 'Jane Doe' or quote_row.client_email is distinct from 'jane@acme.example' then
    raise exception 'TEST FAILED: the converted quote did not carry over the lead''s company/contact fields';
  end if;

  select count(*) into client_count from public.clients where workspace_id = ws_a_id and name = 'ZZ Test 220 Acme Corp';
  if client_count is distinct from 1 then
    raise exception 'TEST FAILED: conversion did not create exactly one new clients row (% found)', client_count;
  end if;

  select * into lead_row from public.marketing_leads where id = lead_id;
  if lead_row.status is distinct from 'converted' or lead_row.converted_sales_quote_id is distinct from quote_row.id
     or lead_row.converted_by is distinct from member_a_id or lead_row.converted_at is null or lead_row.client_id is null then
    raise exception 'TEST FAILED: the lead was not correctly flipped to converted with who/when/client_id recorded';
  end if;

  select count(*) into row_count from public.marketing_lead_activity where marketing_lead_id = lead_id and kind = 'status_change' and body like 'Converted to Sales Quote%';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: conversion did not log a status_change activity row';
  end if;

  raise notice 'TEST PASSED: Section (e) -- converting a qualified lead creates a client, creates a quote with the right carried-over fields, and records who/when on the lead';

  -- ============================================================
  -- Section (f): a second lead for the SAME company reuses the existing
  -- clients row rather than creating a duplicate.
  -- ============================================================

  insert into public.marketing_leads (company_name, contact_name, lead_source, status)
  values ('  zz test 220 acme corp  ', 'Second Contact', 'referral', 'qualified')
  returning id into second_lead_id;

  perform public.convert_marketing_lead_to_quote(second_lead_id);

  select client_id into second_client_id from public.marketing_leads where id = second_lead_id;

  select count(*) into client_count from public.clients where workspace_id = ws_a_id and lower(btrim(name)) = 'zz test 220 acme corp';
  if client_count is distinct from 1 then
    raise exception 'TEST FAILED: a second lead for the same company (case/whitespace-insensitive) created a duplicate clients row (% found)', client_count;
  end if;

  raise notice 'TEST PASSED: Section (f) -- converting a lead for an already-known company reuses the existing clients row, no re-entry duplicate';

  -- ============================================================
  -- Section (g): cross-workspace conversion is rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.convert_marketing_lead_to_quote(lead_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: workspace B''s member could convert workspace A''s lead';
  end if;

  raise notice 'TEST PASSED: Section (g) -- a different workspace''s member cannot convert another workspace''s lead';

  -- ============================================================
  -- Section (h): external_source/external_id dedup is workspace-scoped.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.marketing_leads (company_name, lead_source, external_source, external_id)
  values ('ZZ Test 220 Hubspot Co A', 'hubspot_import', 'hubspot', 'zz-ext-220-shared-id');

  caught := false;
  begin
    insert into public.marketing_leads (company_name, lead_source, external_source, external_id)
    values ('ZZ Test 220 Hubspot Co A Again', 'hubspot_import', 'hubspot', 'zz-ext-220-shared-id');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: the same external_source/external_id pair was accepted twice within one workspace';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.marketing_leads (company_name, lead_source, external_source, external_id)
  values ('ZZ Test 220 Hubspot Co B', 'hubspot_import', 'hubspot', 'zz-ext-220-shared-id');

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.marketing_leads where external_source = 'hubspot' and external_id = 'zz-ext-220-shared-id';
  if row_count is distinct from 2 then
    raise exception 'TEST FAILED: the same external_source/external_id pair across two different workspaces was incorrectly rejected';
  end if;

  raise notice 'TEST PASSED: Section (h) -- external_source/external_id dedup is workspace-scoped, not global';

  -- ============================================================
  -- Section (i): no delete policy -- a DELETE is a silent no-op.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  delete from public.marketing_leads where id = lead_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a lead was deleted despite no delete policy existing (% rows affected)', affected_rows;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.marketing_leads where id = lead_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the lead row is actually gone -- delete should have been silently denied, not partially applied';
  end if;

  raise notice 'TEST PASSED: Section (i) -- no delete policy exists; a DELETE attempt is a silent no-op';

  raise notice 'ALL MIGRATION 220 MARKETING LEADS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;

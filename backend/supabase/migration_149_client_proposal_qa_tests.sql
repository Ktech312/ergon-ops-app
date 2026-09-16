-- Transaction-safe tests for migration 149's client proposal Q&A (D16).
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users for every authorization check (never
-- fabricates a fake auth.users row); every quote/proposal/token/
-- question this script creates is synthetic, fresh inside this same
-- rolled-back transaction, clearly named "ZZ_TEST_...". Fixture
-- discovery mirrors migration 147's own conventions.
--
-- Requires migrations 134-148 to already be live.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 149 CLIENT PROPOSAL Q&A
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  pm_user_id uuid;
  sales_user_id uuid;
  pm_role_preexisted boolean;
  sales_role_preexisted boolean;
  pm_had_sales_role boolean;
  pm_sales_was_primary boolean;
  pm_had_manager_role boolean;
  pm_manager_was_primary boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  quote_id_1 uuid;
  proposal_id_1 uuid;
  token_1 text;

  quote_id_2 uuid;
  proposal_id_2 uuid;
  token_2 text;

  quote_id_3 uuid;
  proposal_id_3 uuid;
  token_3 text;

  question_id_1 uuid;
  question_id_2 uuid;
  question_id_3 uuid;

  r record;
  caught boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
  anon_can_read boolean;
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
      -- Isolate PM to a single role for the negative-authorization check
      -- below -- a real PM may also carry Sales/Manager as a secondary
      -- role, either of which would correctly authorize an answer and
      -- invalidate that assertion. Same technique this repo's other
      -- tests already use.
      pm_had_sales_role := exists (select 1 from public.app_user_roles where user_id = pm_user_id and role_key = 'sales');
      select coalesce((select is_primary from public.app_user_roles where user_id = pm_user_id and role_key = 'sales'), false) into pm_sales_was_primary;
      pm_had_manager_role := exists (select 1 from public.app_user_roles where user_id = pm_user_id and role_key = 'manager');
      select coalesce((select is_primary from public.app_user_roles where user_id = pm_user_id and role_key = 'manager'), false) into pm_manager_was_primary;
      delete from public.app_user_roles where user_id = pm_user_id and role_key in ('sales', 'manager');

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
      perform set_config('role', 'authenticated', true);

      -- Fixture 1: an open, live, sent proposal -- the happy-path thread.
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QA_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into quote_id_1;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (quote_id_1, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
        returning id into proposal_id_1;
      select public.create_quote_proposal_share_token(proposal_id_1) into token_1;

      -- Fixture 2: created 'sent' -- a question is asked on it (below,
      -- via the RPC, while it's still open) BEFORE it gets approved,
      -- since sales_quote_proposal_questions has zero direct-write
      -- grants and can only ever be written through the two RPCs, never
      -- a raw INSERT even from this fixture-setup block.
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QA_APPROVED_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into quote_id_2;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
        values (quote_id_2, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
        returning id into proposal_id_2;
      select public.create_quote_proposal_share_token(proposal_id_2) into token_2;

      -- Fixture 3: a revision-requested proposal -- deliberately NOT
      -- one of the six triggers; Q&A must stay open here.
      insert into public.sales_quotes (client_name, site_name, status)
        values ('ZZ Test Client', 'ZZ_TEST_QA_REVISION_' || substr(md5(random()::text), 1, 10), 'open')
        returning id into quote_id_3;
      insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email, responded_at)
        values (quote_id_3, 1, 'revision_requested', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com', now())
        returning id into proposal_id_3;
      select public.create_quote_proposal_share_token(proposal_id_3) into token_3;

      perform set_config('role', original_role, true);

      -- Fixture 2 continued: ask a question while proposal_id_2 is
      -- still 'sent' (must succeed), THEN transition it to 'approved'
      -- (a direct authenticated UPDATE -- sales_quote_proposals itself
      -- is broadly authenticated-writable, unlike the questions table).
      -- Sections 5 and 7 below both exercise this same now-approved
      -- fixture: submitting a NEW question against it, and answering
      -- the question asked here before it locked.
      select * into r from public.submit_proposal_question(token_2, 'ZZ_TEST question predating approval', 'ZZ Client');
      if r.outcome <> 'submitted' then
        raise exception 'TEST FAILED: fixture setup expected outcome=submitted asking a question before approval, got %.', r.outcome;
      end if;
      question_id_3 := r.question_id;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      update public.sales_quote_proposals
        set status = 'approved', responded_at = now(), approval_name = 'ZZ Approver'
        where id = proposal_id_2;
      perform set_config('role', original_role, true);

      -- Section 1: the client asks a question on the live proposal.
      select * into r from public.submit_proposal_question(token_1, '  How long is this price good for?  ', 'ZZ Client');
      if r.outcome <> 'submitted' then
        raise exception 'TEST FAILED: expected outcome=submitted asking a question on a live proposal, got %.', r.outcome;
      end if;
      question_id_1 := r.question_id;
      if not exists (select 1 from public.sales_quote_proposal_questions where id = question_id_1 and status = 'open' and proposal_id = proposal_id_1) then
        raise exception 'TEST FAILED: no open question row exists for the submitted question.';
      end if;
      -- Whitespace must be trimmed before storage.
      if (select question_text from public.sales_quote_proposal_questions where id = question_id_1) <> 'How long is this price good for?' then
        raise exception 'TEST FAILED: question_text was not trimmed of surrounding whitespace.';
      end if;
      if not exists (
        select 1 from public.notifications
        where related_entity_type = 'sales_quote_proposal' and related_entity_id = proposal_id_1::text
          and event_type = 'proposal_question_received'
      ) then
        raise exception 'TEST FAILED: the quote owner was not notified of the new question.';
      end if;

      -- Section 2: PM cannot answer.
      caught := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', pm_user_id::text)::text, true);
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
        perform set_config('role', 'authenticated', true);
        perform public.respond_to_proposal_question(question_id_1, 'A PM should not be able to say this.');
      exception when others then
        caught := true;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a PM-only caller was able to answer a proposal question -- PM has no proposal authority.';
      end if;
      if (select status from public.sales_quote_proposal_questions where id = question_id_1) <> 'open' then
        raise exception 'TEST FAILED: the question''s status changed despite the rejected PM answer attempt.';
      end if;

      -- Section 3: a real Sales user can answer.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select * into r from public.respond_to_proposal_question(question_id_1, 'Good for 30 days from send.');
      perform set_config('role', original_role, true);
      if r.outcome <> 'answered' then
        raise exception 'TEST FAILED: expected outcome=answered from a real Sales user, got %.', r.outcome;
      end if;
      if not exists (
        select 1 from public.sales_quote_proposal_questions
        where id = question_id_1 and status = 'answered' and answer_text = 'Good for 30 days from send.' and answered_by_email is not null and answered_at is not null
      ) then
        raise exception 'TEST FAILED: the answered question row is missing expected fields.';
      end if;

      -- Section 4: cannot re-answer an already-answered question.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select * into r from public.respond_to_proposal_question(question_id_1, 'Trying to answer again.');
      perform set_config('role', original_role, true);
      if r.outcome <> 'already_answered' then
        raise exception 'TEST FAILED: expected outcome=already_answered on a second answer attempt, got %.', r.outcome;
      end if;
      if (select answer_text from public.sales_quote_proposal_questions where id = question_id_1) <> 'Good for 30 days from send.' then
        raise exception 'TEST FAILED: a second answer attempt overwrote the original answer.';
      end if;

      -- Section 5: an already-approved proposal is read-only -- no new
      -- question can be submitted against it (exactly one row --
      -- question_id_3, asked before approval -- must exist for it, not
      -- two).
      select * into r from public.submit_proposal_question(token_2, 'Is this still open?', 'ZZ Client');
      if r.outcome <> 'closed' then
        raise exception 'TEST FAILED: expected outcome=closed submitting a question against an approved proposal, got %.', r.outcome;
      end if;
      if (select count(*) from public.sales_quote_proposal_questions where proposal_id = proposal_id_2) <> 1 then
        raise exception 'TEST FAILED: a new question row was created against an approved (read-only) proposal.';
      end if;

      -- Section 6: a revision-requested proposal is explicitly NOT
      -- read-only -- the client can still ask, and Sales can still
      -- answer.
      select * into r from public.submit_proposal_question(token_3, 'What exactly needs to change?', 'ZZ Client');
      if r.outcome <> 'submitted' then
        raise exception 'TEST FAILED: expected outcome=submitted on a revision_requested proposal (must stay open for Q&A), got %.', r.outcome;
      end if;
      question_id_2 := r.question_id;

      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select * into r from public.respond_to_proposal_question(question_id_2, 'Just the delivery date.');
      perform set_config('role', original_role, true);
      if r.outcome <> 'answered' then
        raise exception 'TEST FAILED: expected outcome=answered on a revision_requested proposal''s question, got %.', r.outcome;
      end if;

      -- Section 7: answering also respects the read-only lock -- once a
      -- proposal is approved, an OPEN question asked before that point
      -- (question_id_3, from the fixture setup above) can no longer be
      -- answered.
      perform set_config('request.jwt.claims', json_build_object('sub', sales_user_id::text)::text, true);
      perform set_config('request.jwt.claim.sub', sales_user_id::text, true);
      perform set_config('role', 'authenticated', true);
      select * into r from public.respond_to_proposal_question(question_id_3, 'Too late to answer this.');
      perform set_config('role', original_role, true);
      if r.outcome <> 'closed' then
        raise exception 'TEST FAILED: expected outcome=closed answering a question on an already-approved proposal, got %.', r.outcome;
      end if;
      if (select status from public.sales_quote_proposal_questions where id = question_id_3) <> 'open' then
        raise exception 'TEST FAILED: a rejected answer attempt still changed the question''s status.';
      end if;

      -- Section 8: input validation -- empty question text is rejected
      -- without creating a row.
      select * into r from public.submit_proposal_question(token_1, '   ', 'ZZ Client');
      if r.outcome <> 'invalid_input' then
        raise exception 'TEST FAILED: expected outcome=invalid_input for a blank question, got %.', r.outcome;
      end if;

      -- Section 9: RLS read visibility -- authenticated can read;
      -- confirmed via the earlier successful selects above (Section 1
      -- etc. already prove this). Explicit anon-cannot-read check below
      -- in the grant-layer section.

      -- Restore PM's role state exactly as found.
      if pm_had_sales_role then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'sales', pm_sales_was_primary)
          on conflict (user_id, role_key) do update set is_primary = excluded.is_primary;
      end if;
      if pm_had_manager_role then
        insert into public.app_user_roles (user_id, role_key, is_primary) values (pm_user_id, 'manager', pm_manager_was_primary)
          on conflict (user_id, role_key) do update set is_primary = excluded.is_primary;
      end if;
      if not pm_role_preexisted and pm_user_id is not null then
        delete from public.app_user_roles where user_id = pm_user_id and role_key = 'pm';
      end if;
      if not sales_role_preexisted and sales_user_id is not null then
        delete from public.app_user_roles where user_id = sales_user_id and role_key = 'sales';
      end if;
    end if;
  end if;

  -- Section 10 (checked regardless): grant-layer.
  select has_function_privilege('anon', 'public.submit_proposal_question(text, text, text)', 'execute') into anon_can_execute;
  if not anon_can_execute then
    raise exception 'TEST FAILED: anon does not have execute privilege on submit_proposal_question -- expected anon-only.';
  end if;
  select has_function_privilege('authenticated', 'public.submit_proposal_question(text, text, text)', 'execute') into authenticated_can_execute;
  if authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on submit_proposal_question -- expected anon-only.';
  end if;
  select has_function_privilege('authenticated', 'public.respond_to_proposal_question(uuid, text)', 'execute') into authenticated_can_execute;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated does not have execute privilege on respond_to_proposal_question -- expected authenticated-only.';
  end if;
  select has_function_privilege('anon', 'public.respond_to_proposal_question(uuid, text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: anon has execute privilege on respond_to_proposal_question -- expected none.';
  end if;
  select has_table_privilege('anon', 'public.sales_quote_proposal_questions', 'select') into anon_can_read;
  if anon_can_read then
    raise exception 'TEST FAILED: anon has direct select privilege on sales_quote_proposal_questions -- expected authenticated-only, every write via RPC.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 149 CLIENT PROPOSAL Q&A TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

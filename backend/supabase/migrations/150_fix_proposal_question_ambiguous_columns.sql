-- Fixes a real, confirmed bug in migration 149's two new RPCs, found by
-- E's live run of migration 149's own canonical test:
--   ERROR: 42702: column reference "asked_at" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Root cause: submit_proposal_question() declares `returns table (outcome
-- text, question_id uuid, asked_at timestamptz)` and
-- respond_to_proposal_question() declares `returns table (outcome text,
-- answered_at timestamptz)`. Every RETURNS TABLE column name becomes an
-- implicit PL/pgSQL variable in scope for the WHOLE function body -- so
-- the bare `asked_at`/`answered_at` in each function's own INSERT/UPDATE
-- ... RETURNING clause is genuinely ambiguous between that implicit
-- variable and sales_quote_proposal_questions' own column of the same
-- name. This is the EXACT bug class migration 121 already hit and fixed
-- for respond_to_quote_proposal's own RETURNS TABLE columns (documented
-- in that migration's own header) -- missed here because migration 149
-- was drafted and reviewed without live execution catching it until
-- E's own test run did.
--
-- Fix: alias the table in both statements and qualify every RETURNING
-- column with it, exactly matching respond_to_quote_proposal's own
-- established `as sqp` / `sqp.column` pattern (migration 139). Logic,
-- signatures, and return shapes are otherwise byte-for-byte unchanged --
-- this is a column-qualification fix only, never a behavior change.
--
-- Per this repo's standing rule, migration 149 itself is NOT edited or
-- rerun -- a correction to an already-applied migration is always a new,
-- sequentially-numbered migration.
--
-- Confirm 150 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

create or replace function public.submit_proposal_question(
  share_token text,
  question_text text,
  asker_name text
)
returns table (
  outcome text,
  question_id uuid,
  asked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_quote_id uuid;
  proposal_status text;
  token_status text;
  token_expires_at timestamptz;
  trimmed_question text;
  new_question_id uuid;
  new_asked_at timestamptz;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
begin
  trimmed_question := btrim(coalesce(question_text, ''));
  if char_length(trimmed_question) = 0 or char_length(trimmed_question) > 4000 then
    return query select 'invalid_input'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select t.status, t.expires_at, p.id, p.status, p.quote_id
  into token_status, token_expires_at, target_id, proposal_status, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal';

  if target_id is null then
    return query select 'invalid_token'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if proposal_status in ('approved', 'rejected') then
    return query select 'closed'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- Fixed: aliased + qualified RETURNING columns (were bare `id,
  -- asked_at`, ambiguous against this function's own RETURNS TABLE
  -- variable of the same name).
  insert into public.sales_quote_proposal_questions as sqpq (proposal_id, question_text, asker_name)
  values (target_id, trimmed_question, nullif(btrim(coalesce(asker_name, '')), ''))
  returning sqpq.id, sqpq.asked_at into new_question_id, new_asked_at;

  -- Notify the quote's owner -- best-effort, mirrors
  -- quote_proposal_responded's own established pattern exactly. A
  -- notification failure must never block the client's question from
  -- being recorded.
  begin
    select q.created_by_email, q.site_name into owner_email, quote_site_name
    from public.sales_quotes q where q.id = target_quote_id;

    select is_active into rule_active from public.notification_rules where event_type = 'proposal_question_received';

    if owner_email is not null and coalesce(rule_active, false) then
      insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
      values (
        owner_email,
        'proposal_question_received',
        'New question on a proposal',
        coalesce(quote_site_name, 'A quote') || ' -- ' || coalesce(nullif(btrim(coalesce(asker_name, '')), ''), 'the client') || ' asked: '
          || left(trimmed_question, 200),
        'sales_quote_proposal',
        target_id::text,
        'proposal_question_received:' || new_question_id::text
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  exception when others then
    null;
  end;

  return query select 'submitted'::text, new_question_id, new_asked_at;
end;
$$;

revoke all on function public.submit_proposal_question(text, text, text) from public;
revoke execute on function public.submit_proposal_question(text, text, text) from authenticated;
grant execute on function public.submit_proposal_question(text, text, text) to anon;

create or replace function public.respond_to_proposal_question(
  p_question_id uuid,
  p_answer_text text
)
returns table (
  outcome text,
  answered_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_question_status text;
  v_proposal_id uuid;
  v_proposal_status text;
  v_token_status text;
  v_token_expires_at timestamptz;
  v_trimmed_answer text;
  v_answered_at timestamptz;
begin
  if not (public.is_app_admin(v_actor_id) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may answer a proposal question.' using errcode = 'EC001';
  end if;

  v_trimmed_answer := btrim(coalesce(p_answer_text, ''));
  if char_length(v_trimmed_answer) = 0 or char_length(v_trimmed_answer) > 4000 then
    raise exception 'Enter an answer of up to 4000 characters.' using errcode = 'EC001';
  end if;

  select q.status, q.proposal_id into v_question_status, v_proposal_id
  from public.sales_quote_proposal_questions q
  where q.id = p_question_id;

  if v_proposal_id is null then
    return query select 'not_found'::text, null::timestamptz;
    return;
  end if;

  if v_question_status <> 'open' then
    return query select 'already_answered'::text, null::timestamptz;
    return;
  end if;

  select p.status into v_proposal_status from public.sales_quote_proposals p where p.id = v_proposal_id;

  select t.status, t.expires_at into v_token_status, v_token_expires_at
  from public.public_share_tokens t
  where t.entity_type = 'sales_quote_proposal' and t.entity_id = v_proposal_id;

  if v_proposal_status in ('approved', 'rejected')
    or v_token_status in ('superseded', 'temporarily_disabled', 'permanently_revoked')
    or (v_token_expires_at is not null and v_token_expires_at <= now())
  then
    return query select 'closed'::text, null::timestamptz;
    return;
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  -- Fixed: aliased + qualified WHERE/RETURNING columns (bare `answered_at`
  -- in RETURNING was ambiguous against this function's own RETURNS TABLE
  -- variable of the same name; `id` in WHERE was not actually ambiguous
  -- but is qualified too now for consistency with the alias).
  update public.sales_quote_proposal_questions as sqpq
  set status = 'answered',
      answer_text = v_trimmed_answer,
      answered_by = v_actor_id,
      answered_by_email = v_actor_email,
      answered_at = now()
  where sqpq.id = p_question_id
  returning sqpq.answered_at into v_answered_at;

  return query select 'answered'::text, v_answered_at;
end;
$$;

revoke all on function public.respond_to_proposal_question(uuid, text) from public;
revoke execute on function public.respond_to_proposal_question(uuid, text) from anon;
grant execute on function public.respond_to_proposal_question(uuid, text) to authenticated;

commit;

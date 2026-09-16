-- Sales Batch (D16, approved 2026-09-15): client proposal Q&A.
--
-- Design (matches PRODUCT_PROPOSAL_QA_AND_OPTIONAL_BOM_DECISION.md §1,
-- as corrected by D16's own answer):
--   - NOT built on the internal `channels` system -- see the linked
--     doc's §1.1 for the full re-trace of why that doesn't fit
--     (no anonymous-write path, no actual client-channel implementation
--     despite a schema placeholder, no per-quote/version scoping).
--   - Scoped to ONE PROPOSAL VERSION (sales_quote_proposal_questions.
--     proposal_id references sales_quote_proposals, not sales_quotes) --
--     E's own correction to the recommended default, which had suggested
--     quote-level scoping.
--   - Any Sales, Sales Manager, or workspace admin may answer -- PM has
--     no proposal authority, matching request_or_send_quote_proposal_
--     version()'s own existing check (migration 147) exactly.
--   - Notifies the quote's owner (sales_quotes.created_by_email) when a
--     question comes in, reusing the exact insert-into-notifications
--     pattern quote_proposal_responded already uses (migration 054/139) --
--     same table, same is_active gate, same dedupe_key discipline, just a
--     new event_type. THE LIVE notification_rules.event_type CHECK
--     constraint's own definition was confirmed directly from production
--     before this migration was finalized (2026-09-15) -- via
--     pg_get_constraintdef(oid), independently cross-checked against a
--     live row dump of notification_rules, both agreeing on the exact
--     same 13 values -- not reconstructed from old migration files. See
--     HANDOFF.md for why that specific mistake has already caused a real
--     production failure once before in this repo (migration 054's own
--     header records the near-miss).
--   - Read-only after any of SIX triggers, exactly as decided: the
--     proposal itself reaching 'approved' or 'rejected', or its token
--     becoming superseded/expired/temporarily_disabled/
--     permanently_revoked. Deliberately NOT locked by
--     'revision_requested' -- a client who requested a revision is still
--     in an active back-and-forth and should still be able to ask
--     follow-up questions; Sales should still be able to answer them.
--     Both new RPCs check the identical six-trigger condition, so a
--     thread locks for new questions AND new answers at the same moment.
--
-- Two new RPCs, mirroring get_quote_proposal_by_token/
-- respond_to_quote_proposal's own established token-resolution shape:
--   - submit_proposal_question(share_token, question_text, asker_name) --
--     anon-granted, the client's "Ask a question" action.
--   - respond_to_proposal_question(question_id, answer_text) --
--     authenticated-granted (sales/manager/admin only), the rep's reply.
--
-- sales_quote_proposal_questions: RLS read-only for authenticated (any
-- internal user, matching sales_quote_proposals' own read posture) --
-- ZERO write policies, every write goes through the two RPCs above,
-- applying Queue C2.7's "close direct-write bypasses" discipline from
-- day one. Explicit grant-layer correction from the start (migration
-- 141's lesson): this project's default privileges would otherwise
-- auto-grant broad table access regardless of what's written here.
--
-- Confirm 149 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- 1. Live list CONFIRMED 2026-09-15 via pg_get_constraintdef(oid)
--    against the real notification_rules_event_type_check constraint,
--    independently cross-checked against a live row dump of
--    notification_rules -- both agree exactly: build_stage_changed,
--    catalog_price_change_requested, catalog_price_change_reviewed,
--    direct_message_received, low_stock_reached, mentioned,
--    purchase_request_status_changed, quote_proposal_responded,
--    submittal_responded, task_assigned, task_overdue,
--    task_status_changed, user_signup_pending, PLUS
--    proposal_question_received, added here.
-- ============================================================

alter table public.notification_rules drop constraint if exists notification_rules_event_type_check;
alter table public.notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'build_stage_changed', 'catalog_price_change_requested', 'catalog_price_change_reviewed',
    'direct_message_received', 'low_stock_reached', 'mentioned',
    'purchase_request_status_changed', 'quote_proposal_responded', 'submittal_responded',
    'task_assigned', 'task_overdue', 'task_status_changed', 'user_signup_pending',
    'proposal_question_received'
  ));

insert into public.notification_rules (event_type, channels, is_active) values
  ('proposal_question_received', '{in_app}', true)
on conflict (event_type) do nothing;

-- ============================================================
-- 2. The questions table.
-- ============================================================

create table if not exists public.sales_quote_proposal_questions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.sales_quote_proposals(id) on delete cascade,
  question_text text not null check (char_length(question_text) between 1 and 4000),
  asker_name text,
  asked_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'answered')),
  answer_text text check (answer_text is null or char_length(answer_text) between 1 and 4000),
  answered_by uuid references auth.users(id),
  answered_by_email text,
  answered_at timestamptz
);

create index if not exists idx_proposal_questions_proposal on public.sales_quote_proposal_questions(proposal_id);
create index if not exists idx_proposal_questions_status on public.sales_quote_proposal_questions(status);

alter table public.sales_quote_proposal_questions enable row level security;

create policy "authenticated read proposal questions"
  on public.sales_quote_proposal_questions for select to authenticated using (true);

revoke all on table public.sales_quote_proposal_questions from public, anon, authenticated;
grant select on table public.sales_quote_proposal_questions to authenticated;

-- ============================================================
-- 3a. The client's "Ask a question" action.
-- ============================================================

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

  insert into public.sales_quote_proposal_questions (proposal_id, question_text, asker_name)
  values (target_id, trimmed_question, nullif(btrim(coalesce(asker_name, '')), ''))
  returning id, asked_at into new_question_id, new_asked_at;

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

-- ============================================================
-- 3b. The rep's reply.
-- ============================================================

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

  update public.sales_quote_proposal_questions
  set status = 'answered',
      answer_text = v_trimmed_answer,
      answered_by = v_actor_id,
      answered_by_email = v_actor_email,
      answered_at = now()
  where id = p_question_id
  returning answered_at into v_answered_at;

  return query select 'answered'::text, v_answered_at;
end;
$$;

revoke all on function public.respond_to_proposal_question(uuid, text) from public;
revoke execute on function public.respond_to_proposal_question(uuid, text) from anon;
grant execute on function public.respond_to_proposal_question(uuid, text) to authenticated;

commit;

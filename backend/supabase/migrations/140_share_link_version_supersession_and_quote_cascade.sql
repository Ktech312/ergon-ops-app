-- Queue C2.5 (2026-09-13): version supersession + quote soft-delete/restore
-- cascade -- the two pieces of genuinely NEW WORK PRODUCT_SHARE_LINK_
-- EXPIRATION_REVOCATION_DECISION.md Part 9.1 items 5/6 and Part 9.5 Stage 6
-- name for this queue ("auto-supersede-on-new-version",
-- "auto-disable-on-quote-soft-delete (and its restore counterpart)").
-- Requires migrations 137, 138, and 139 to already be live (uses
-- public_share_tokens.status/superseded_by_token, workspace_share_link_
-- settings, share_link_actions, and generate_share_token() -- all added by
-- those three).
--
-- Everything else Part 9.5 lists under "Stage 6" (PM-reassignment transfer,
-- two-party conversion-approval flow, capability-based override+reason) is
-- explicitly OUT OF SCOPE for Queue C2 per CONTINUOUS_CODER_HANDOFF.md's own
-- boundary -- this migration implements only the two share-link-lifecycle
-- pieces, nothing from the Billing/PM-handoff/capability system.
--
-- Confirm 140 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review, same as every other migration in
-- this repository.

begin;

-- ============================================================
-- Part A: quote soft-delete cascade (Part 9.1 item 6 / Part 8's quote-
-- deletion note: "restoring the quote does NOT automatically reactivate its
-- old links... links that were already permanently revoked or already
-- superseded... stay permanently dead").
--
-- A trigger, not a new RPC -- deleteSalesQuote/restoreSalesQuote
-- (src/persistence.ts) already write sales_quotes.deleted_at directly via
-- PostgREST under its existing "authenticated write" policy (migration 033);
-- narrowing that write path is a separate, later concern (not this queue's
-- job -- C2.7 covers direct-write closure on public_share_tokens/
-- sales_quote_proposals/project_submittals specifically, not sales_quotes
-- itself). Adding a trigger here requires no frontend change at all: the
-- existing delete/restore calls keep working exactly as today, and the
-- cascade simply starts happening as a consequence.
--
-- security definer + search_path='' even though today's wide-open
-- "authenticated manage" policy on public_share_tokens (migration 025)
-- would already let this trigger's UPDATE succeed under the invoking role --
-- this keeps the trigger correct even after C2.7 eventually narrows that
-- policy, rather than silently breaking the cascade at that future point.
--
-- Only fires on the null -> non-null transition (a genuine new soft-delete),
-- and only ever touches tokens currently 'active' -- an already-disabled
-- token is left exactly as it is (no redundant re-disable/re-log), and an
-- already-permanently_revoked or already-superseded token is never touched,
-- matching the decided "no loophole around the no-re-enable rule" note.
-- Restoring the quote (non-null -> null) intentionally has NO trigger at
-- all: the decided behavior for restore is that nothing automatic happens
-- to links, so there is nothing here to implement for that direction.
-- ============================================================

create or replace function public.cascade_quote_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_actor_email text;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    v_actor_email := (select email from auth.users where id = auth.uid());

    for r in
      select t.token, t.entity_id
      from public.public_share_tokens t
      join public.sales_quote_proposals p on p.id = t.entity_id
      where t.entity_type = 'sales_quote_proposal'
        and p.quote_id = new.id
        and t.status = 'active'
    loop
      update public.public_share_tokens
      set status = 'temporarily_disabled', disabled_at = now(), disabled_by = auth.uid(),
          disabled_reason = 'Quote deleted'
      where token = r.token;

      insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email, reason)
      values (r.token, 'sales_quote_proposal', r.entity_id, 'temporarily_disabled', auth.uid(), v_actor_email, 'Quote deleted');
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.cascade_quote_soft_delete() from public;

drop trigger if exists trg_cascade_quote_soft_delete on public.sales_quotes;
create trigger trg_cascade_quote_soft_delete
  after update of deleted_at on public.sales_quotes
  for each row
  execute function public.cascade_quote_soft_delete();

-- ============================================================
-- Part B: auto-supersede-on-new-version (Part 9.1 item 5's "superseded by a
-- new version" case; Part 1.5's decided replacement of the old "a new
-- version leaves every prior version's token untouched, forever" behavior).
--
-- Today's frontend creates a new version in two separate, non-atomic
-- client-driven steps (src/main.tsx ~5173-5178 submittals, ~5289-5293
-- proposals): a direct INSERT into project_submittals/sales_quote_proposals
-- (createSubmittal/createQuoteProposal), then a second call to create the
-- new version's own share token (createSubmittalShareToken/
-- createQuoteProposalShareToken -- migration 138's create_submittal_
-- share_token/create_quote_proposal_share_token replace the OLD direct-
-- INSERT half of that second step, once the frontend is switched to call
-- them). Layering "then find and supersede the prior version's token" on as
-- a THIRD separate client-driven step would reopen exactly the kind of
-- multi-round-trip window this whole queue exists to close: a crash or
-- failed request between steps could leave both the old and the new
-- version's links simultaneously respondable, with no single moment where
-- the transition is atomic.
--
-- So these two new RPCs each do all three things (create the version row,
-- create its token, supersede every still-live token of every OTHER version
-- of the same entity) inside one function call/transaction. They are the
-- actual replacement for the current two-step frontend flow specifically
-- for "create a new version and send it" -- migration 138's narrower create_
-- submittal_share_token/create_quote_proposal_share_token remain valid,
-- unmodified, lower-level primitives (token-creation-only, no supersession)
-- that this migration does not remove; nothing today calls them for any
-- OTHER purpose, so in practice the frontend switch (a separate, later,
-- code-only change, alongside C2.7 per that migration's own note) will call
-- these two new functions instead, not both.
--
-- Version numbers are computed server-side here (max(version)+1 at the
-- moment of insert) rather than trusting the client-computed value the
-- current direct-INSERT path uses (src/main.tsx's own `nextVersion =
-- existing.length ? Math.max(...)+1 : 1`, computed from a separate earlier
-- read) -- a real, if narrow, race window the old client-computed approach
-- left open (two concurrent "create version" clicks could both compute the
-- same next number). Closing it is a natural side effect of centralizing
-- version-row creation here, not a separately scoped fix.
-- ============================================================

create or replace function public.create_and_send_submittal_version(
  p_project_id uuid,
  p_content_snapshot jsonb,
  p_client_name text,
  p_client_email text
)
returns table (submittal_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_submittal_id uuid;
  v_token text;
  v_default_expiration interval;
  v_actor_email text;
  r record;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('pm')) then
    raise exception 'Only a PM or admin may create and send a submittal version.' using errcode = 'EC001';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'This project could not be found.' using errcode = 'EC003';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.project_submittals where project_id = p_project_id;

  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email, sent_at)
  values (p_project_id, v_next_version, 'sent', coalesce(p_content_snapshot, '{}'::jsonb), p_client_name, p_client_email, now())
  returning id into v_submittal_id;

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = public.active_workspace_id();

  v_token := public.generate_share_token();
  v_actor_email := (select email from auth.users where id = auth.uid());

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'project_submittal', v_submittal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'project_submittal', v_submittal_id, 'created', auth.uid(), v_actor_email);

  for r in
    select t.token as old_token, t.entity_id as old_entity_id
    from public.public_share_tokens t
    join public.project_submittals s on s.id = t.entity_id
    where t.entity_type = 'project_submittal'
      and s.project_id = p_project_id
      and s.id <> v_submittal_id
      and t.status in ('active', 'temporarily_disabled')
  loop
    -- `pst` alias + qualified WHERE is required, not cosmetic: both
    -- functions here declare `returns table (..., token text)`, and in
    -- plpgsql a RETURNS TABLE column becomes an implicit variable in
    -- scope for the whole function body -- an unqualified `token` in this
    -- WHERE clause is genuinely ambiguous between that variable and
    -- public_share_tokens.token (Postgres error 42702), the exact bug
    -- class migration 121 already hit and documented for
    -- respond_to_quote_proposal's own RETURNS TABLE columns.
    update public.public_share_tokens as pst
    set status = 'superseded', superseded_by_token = v_token
    where pst.token = r.old_token;

    insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
    values (r.old_token, 'project_submittal', r.old_entity_id, 'superseded', auth.uid(), v_actor_email);
  end loop;

  return query select v_submittal_id, v_token;
end;
$$;

revoke all on function public.create_and_send_submittal_version(uuid, jsonb, text, text) from public;
revoke execute on function public.create_and_send_submittal_version(uuid, jsonb, text, text) from anon;
grant execute on function public.create_and_send_submittal_version(uuid, jsonb, text, text) to authenticated;

create or replace function public.create_and_send_quote_proposal_version(
  p_quote_id uuid,
  p_content_snapshot jsonb,
  p_client_name text,
  p_client_email text
)
returns table (proposal_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
  v_proposal_id uuid;
  v_token text;
  v_default_expiration interval;
  v_actor_email text;
  r record;
begin
  if not (public.is_app_admin(auth.uid()) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may create and send a proposal version.' using errcode = 'EC001';
  end if;

  if not exists (select 1 from public.sales_quotes where id = p_quote_id) then
    raise exception 'This quote could not be found.' using errcode = 'EC003';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.sales_quote_proposals where quote_id = p_quote_id;

  insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email, sent_at)
  values (p_quote_id, v_next_version, 'sent', coalesce(p_content_snapshot, '{}'::jsonb), p_client_name, p_client_email, now())
  returning id into v_proposal_id;

  select default_expiration_open_documents into v_default_expiration
  from public.workspace_share_link_settings
  where workspace_id = public.active_workspace_id();

  v_token := public.generate_share_token();
  v_actor_email := (select email from auth.users where id = auth.uid());

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
  values (
    v_token, 'sales_quote_proposal', v_proposal_id,
    case when v_default_expiration is not null then now() + v_default_expiration else null end
  );

  insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
  values (v_token, 'sales_quote_proposal', v_proposal_id, 'created', auth.uid(), v_actor_email);

  for r in
    select t.token as old_token, t.entity_id as old_entity_id
    from public.public_share_tokens t
    join public.sales_quote_proposals p on p.id = t.entity_id
    where t.entity_type = 'sales_quote_proposal'
      and p.quote_id = p_quote_id
      and p.id <> v_proposal_id
      and t.status in ('active', 'temporarily_disabled')
  loop
    -- `pst` alias + qualified WHERE is required, not cosmetic: both
    -- functions here declare `returns table (..., token text)`, and in
    -- plpgsql a RETURNS TABLE column becomes an implicit variable in
    -- scope for the whole function body -- an unqualified `token` in this
    -- WHERE clause is genuinely ambiguous between that variable and
    -- public_share_tokens.token (Postgres error 42702), the exact bug
    -- class migration 121 already hit and documented for
    -- respond_to_quote_proposal's own RETURNS TABLE columns.
    update public.public_share_tokens as pst
    set status = 'superseded', superseded_by_token = v_token
    where pst.token = r.old_token;

    insert into public.share_link_actions (token, entity_type, entity_id, action, actor_id, actor_email)
    values (r.old_token, 'sales_quote_proposal', r.old_entity_id, 'superseded', auth.uid(), v_actor_email);
  end loop;

  return query select v_proposal_id, v_token;
end;
$$;

revoke all on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from public;
revoke execute on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from anon;
grant execute on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) to authenticated;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - The frontend still calls createSubmittal+createSubmittalShareToken /
--     createQuoteProposal+createQuoteProposalShareToken (the old two-step
--     flow). Switching src/main.tsx's "Create & Send" handlers to call
--     create_and_send_submittal_version/create_and_send_quote_proposal_
--     version instead -- and updating the version-comparison/history UI to
--     show a superseded prior version's own distinct state -- is a
--     separate, later, code-only change (part of C2.6), shipped only after
--     E confirms this migration and its test both succeeded.
--   - No PM-reassignment, conversion-approval, or capability-system work
--     from Part 9.5 Stage 6 is included here -- explicitly out of scope for
--     Queue C2 per CONTINUOUS_CODER_HANDOFF.md's own boundary.
--   - Direct-write closure on sales_quotes/sales_quote_proposals/
--     project_submittals remains untouched -- that is C2.7's job, after the
--     sanctioned RPCs (including these two) are actually live and called.
-- ============================================================

commit;

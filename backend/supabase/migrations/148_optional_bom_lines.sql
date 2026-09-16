-- Sales Batch (D17, approved 2026-09-15): optional BOM line items.
--
-- Scope, exactly as decided -- do NOT read this as mutually-exclusive
-- "alternate" groups. Every optional line is independently toggleable; a
-- client can select any subset of them. True alternate groups (choose
-- exactly one of several) need a separate grouping rule and are an
-- explicitly later, still-undecided product decision -- nothing in this
-- migration builds or implies grouping.
--
-- Design (matches PRODUCT_PROPOSAL_QA_AND_OPTIONAL_BOM_DECISION.md §2,
-- as corrected by D17's own answer):
--   1. sales_quote_bom_lines.is_optional -- Sales flags a line optional
--      while building the quote. Written through the existing direct
--      PATCH path (updateSalesQuoteBomLine, persistence.ts) -- no new
--      RPC needed for this half; the table's existing "authenticated
--      write" policy (migration 048) already covers one more column.
--   2. Live subtotal recomputation while the client reviews needs NO new
--      persisted state or write path -- content_snapshot already freezes
--      every line's unitPrice/qty at send time; the frontend (once it
--      ships, separately, after this migration is confirmed) will add
--      `id`/`isOptional` to each frozen line and recompute client-side
--      using the exact same rounding math as computeProposalTotals()
--      (persistence.ts) already uses. Required lines are always
--      included; an optional line counts only once the client selects
--      it -- the client-side default (unselected/unchecked) is a
--      frontend concern, not this migration's.
--   3. The final selection is captured ATOMICALLY with the client's one
--      terminal response (approve/reject/request-revision), by adding one
--      new parameter to the existing respond_to_quote_proposal() RPC --
--      not a second, separately-saved write path. The server, never the
--      client, computes and stores the resulting final totals from the
--      frozen snapshot, the same "never trust a client-submitted price"
--      discipline migration 136 established for frozen pricing generally.
--      The existing `where sqp.status = 'sent'` guard this function
--      already had (migration 139) is what makes the selection
--      immutable after response -- a second call simply falls into the
--      pre-existing `already_responded` branch, completely unmodified,
--      and never recomputes or overwrites anything. Changing the
--      selection after response genuinely requires a new proposal
--      version, exactly as decided -- there is no other write path that
--      could touch these columns once set.
--
-- Deliberately NOT done here: no change to what respond_to_quote_proposal
-- returns to the caller (still outcome/status/responded_at/approval_name/
-- version, unchanged) -- nothing today needs to display the final totals
-- back to the client immediately after responding; extending the return
-- shape later, if a UI need for it appears, is a trivial follow-up on top
-- of columns that already exist, not a reason to add unused surface now.
--
-- Confirm 148 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

alter table public.sales_quote_bom_lines
  add column if not exists is_optional boolean not null default false;

alter table public.sales_quote_proposals
  add column if not exists selected_optional_line_ids uuid[],
  add column if not exists final_subtotal numeric(12,2),
  add column if not exists final_discount_amount numeric(12,2),
  add column if not exists final_tax_amount numeric(12,2),
  add column if not exists final_grand_total numeric(12,2);

-- Explicit drop before recreate: adding a new parameter changes this
-- function's signature, and this repo prefers an explicit, unambiguous
-- DROP + CREATE over relying on CREATE OR REPLACE's parameter-addition
-- rules for a security definer function this consequential. Both
-- statements run in the same transaction, so there is no window where
-- the function is missing.
drop function if exists public.respond_to_quote_proposal(text, text, text, text, text);

create or replace function public.respond_to_quote_proposal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text,
  -- p_-prefixed deliberately, unlike its four siblings above -- avoids
  -- colliding with the new sales_quote_proposals.selected_optional_line_ids
  -- column of (deliberately) the same conceptual name inside this
  -- function's own UPDATE statement below.
  p_selected_optional_line_ids uuid[] default '{}'::uuid[]
)
returns table (
  outcome text,
  status text,
  responded_at timestamptz,
  approval_name text,
  version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  snapshot jsonb;
  target_quote_id uuid;
  token_status text;
  token_expires_at timestamptz;
  updated_status text;
  updated_responded_at timestamptz;
  updated_approval_name text;
  updated_version integer;
  current_status text;
  current_responded_at timestamptz;
  current_approval_name text;
  current_version integer;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
  v_final_subtotal numeric(12,2);
  v_final_discount_amount numeric(12,2);
  v_final_tax_amount numeric(12,2);
  v_final_grand_total numeric(12,2);
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  if p_selected_optional_line_ids is not null and array_length(p_selected_optional_line_ids, 1) > 200 then
    raise exception 'Too many optional line selections.' using errcode = 'EC001';
  end if;

  select t.status, t.expires_at, p.id, p.content_snapshot, p.quote_id
  into token_status, token_expires_at, target_id, snapshot, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal';

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  -- D17: server-computed final totals from the frozen snapshot -- a
  -- required line always counts; an optional line counts only if its id
  -- is in p_selected_optional_line_ids. Left NULL (not computed or
  -- guessed) for any snapshot sent before pricing existed (migration
  -- 136), same "absent means predates the feature" rule subtotal/
  -- grandTotal already follow on ProposalSnapshot itself. Wrapped
  -- defensively, mirroring create_project_from_quote()'s own
  -- accepted_proposal_total handling (migration 136) -- a malformed or
  -- unexpected snapshot shape must never block a real client response
  -- from completing.
  if snapshot ? 'grandTotal' then
    begin
      select coalesce(round(sum(
               round(((line->>'unitPrice')::numeric) * ((line->>'qty')::numeric), 2)
             ), 2), 0)
      into v_final_subtotal
      from jsonb_array_elements(snapshot->'bom') as line
      where coalesce((line->>'isOptional')::boolean, false) = false
         or (line->>'id') = any(p_selected_optional_line_ids::text[]);

      v_final_discount_amount := round(v_final_subtotal * coalesce((snapshot->>'discountPercent')::numeric, 0) / 100, 2);
      v_final_tax_amount := round((v_final_subtotal - v_final_discount_amount) * coalesce((snapshot->>'taxRate')::numeric, 0) / 100, 2);
      v_final_grand_total := round(v_final_subtotal - v_final_discount_amount + v_final_tax_amount, 2);
    exception when others then
      v_final_subtotal := null;
      v_final_discount_amount := null;
      v_final_tax_amount := null;
      v_final_grand_total := null;
    end;
  end if;

  update public.sales_quote_proposals as sqp
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      selected_optional_line_ids = p_selected_optional_line_ids,
      final_subtotal = v_final_subtotal,
      final_discount_amount = v_final_discount_amount,
      final_tax_amount = v_final_tax_amount,
      final_grand_total = v_final_grand_total,
      updated_at = now()
  where sqp.id = target_id
    and sqp.status = 'sent'
  returning sqp.status, sqp.responded_at, sqp.approval_name, sqp.version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    select sqp.status, sqp.responded_at, sqp.approval_name, sqp.version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.sales_quote_proposals as sqp
    where sqp.id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  -- Completed-document retention transition (Part 8 item 5): a document
  -- that just received a real response extends its own link's
  -- expiration to the workspace's longer completed-document default,
  -- rather than staying on the shorter open-document window it was
  -- created with. Best-effort -- if no settings row resolves for any
  -- reason, the link simply keeps whatever expiration it already had;
  -- this must never block a real, successful response from completing.
  begin
    update public.public_share_tokens
    set expires_at = now() + (
      select default_expiration_completed_documents from public.workspace_share_link_settings
      where workspace_id = public.active_workspace_id()
    )
    where token = share_token;
  exception when others then
    null;
  end;

  select q.created_by_email, q.site_name into owner_email, quote_site_name
  from public.sales_quotes q where q.id = target_quote_id;

  select is_active into rule_active from public.notification_rules where event_type = 'quote_proposal_responded';

  if owner_email is not null and coalesce(rule_active, false) then
    insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
    values (
      owner_email,
      'quote_proposal_responded',
      'Proposal ' || replace(new_status, '_', ' '),
      coalesce(quote_site_name, 'A quote') || ' proposal v' || updated_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
      'sales_quote_proposal',
      target_id::text,
      'quote_proposal_responded:' || target_id::text || ':' || new_status
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_quote_proposal(text, text, text, text, text, uuid[]) from public;
revoke execute on function public.respond_to_quote_proposal(text, text, text, text, text, uuid[]) from authenticated;
grant execute on function public.respond_to_quote_proposal(text, text, text, text, text, uuid[]) to anon;

commit;

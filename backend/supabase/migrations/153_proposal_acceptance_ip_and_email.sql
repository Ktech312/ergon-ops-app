-- Proposal acceptance hardening (D12 revised, approved 2026-09-16;
-- design/trace in PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md §2). Per E's
-- explicit decision: "Fix the dead approval_ip behavior using
-- server-observed request information, add the verified proposal-
-- recipient email to the acceptance record, and preserve the frozen
-- snapshot/hash/audit trail. Do not claim this is a regulated
-- digital-signature product." Typed-name acceptance stays the v1
-- signature model -- unchanged here.
--
-- Two real problems traced and fixed:
--   1. approval_ip has never held a real value. The browser calls
--      respond_to_quote_proposal directly via the anon PostgREST
--      endpoint, hardcoding approver_ip: "" (src/persistence.ts). A
--      Postgres function has no reliable way to observe the real HTTP
--      client's IP through PostgREST on its own. Fix: a new Vercel
--      route, api/respond-to-proposal.js, reads the real IP from
--      Vercel's own req.headers['x-forwarded-for'] (the standard,
--      documented, already-trustworthy source Vercel's edge sets) and
--      calls this RPC via the service-role key instead of the browser
--      calling it directly -- matching this repo's own established
--      "re-derive trusted values server-side" discipline
--      (api/send-notification-email.js's 2026-09-06/07 security
--      reviews). anon's direct execute grant on this function is
--      revoked in the same migration that ships the new route
--      (matching D4/migration 147's own close+switch-together
--      precedent) -- this repo has no other consumer of the raw anon
--      RPC besides this app's own bundled frontend code, so there is no
--      external integration to break.
--   2. No approval_email column exists at all. Fix: sales_quote_proposals
--      gains approval_email, set from the proposal's OWN client_email
--      (the address Sales actually sent it to) -- not a new client-
--      supplied parameter. This is "verified" by construction: it's
--      pulled from the same trusted server-side row the share token
--      already authorizes access to, never something the person
--      clicking through could type or spoof.
--
-- Untouched, per the standing instruction: approval_content_hash
-- (sha256 of the frozen content_snapshot), the frozen snapshot itself,
-- approval_name (still client-typed, still the v1 trust level), and
-- every status-transition/notification/D17-totals behavior already in
-- this function. This migration does not add a drawn signature, OTP, or
-- third-party e-signature integration, and introduces no new legal-
-- weight claim.
--
-- Historical rows: existing approval_ip='' / approval_email=null rows
-- from before this migration are left exactly as they are -- an
-- accurate record of what was actually captured at the time, not
-- backfilled or guessed.
--
-- migration_148_optional_bom_lines_tests.sql's own grant-layer
-- assertion ("anon does have execute privilege on respond_to_quote_
-- proposal -- expected anon-only") is now superseded by this migration,
-- the same way migration 144 superseded an earlier test's direct-write
-- assumption -- do not re-run 148's old assertion expecting it to still
-- pass; migration_153's own test (below) covers the new state.
--
-- Confirm 153 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

alter table public.sales_quote_proposals add column if not exists approval_email text;

drop function if exists public.respond_to_quote_proposal(text, text, text, text, text, uuid[]);

create function public.respond_to_quote_proposal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text,
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
  target_client_email text;
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

  select t.status, t.expires_at, p.id, p.content_snapshot, p.quote_id, p.client_email
  into token_status, token_expires_at, target_id, snapshot, target_quote_id, target_client_email
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
      -- Verified by construction: the proposal's own client_email, not a
      -- client-supplied parameter -- see this migration's own header.
      approval_email = target_client_email,
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

-- anon's direct-call grant is deliberately NOT re-added here -- see this
-- migration's own header. Only the service role (via
-- api/respond-to-proposal.js) can call this now; service_role keeps its
-- own default execute grant (this project's `alter default privileges`
-- setup, documented in migrations 118/125), no explicit grant needed.
revoke all on function public.respond_to_quote_proposal(text, text, text, text, text, uuid[]) from public, anon, authenticated;

commit;

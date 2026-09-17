-- Phase 3, Group 1 (Clients + Sales Quote containment) -- approved by E
-- under a standing authorization for the full staged Phase 3 rollout
-- (2026-09-16). Built against PRODUCT_PHASE3_PLAN.md's threat model and
-- table group, but the plan itself was written against migration 118 --
-- every table, RLS policy, RPC, and helper function named below was
-- independently re-confirmed against the CURRENT source (migrations
-- through 154) before this file was written, per E's explicit
-- instruction to revalidate rather than trust the old plan verbatim.
-- Material drift found from the original plan, and how this migration
-- accounts for it:
--
--   1. sales_quote_proposals has had NO direct write policy since
--      migration 144 (closed as a share-link-bypass fix, unrelated to
--      tenancy) -- every write already goes through security-definer
--      RPCs only. This migration adds a workspace-scoped SELECT policy
--      for it and deliberately does NOT add any insert/update/delete
--      policy, since doing so would grant a write capability that does
--      not exist today -- the opposite of "preserve current behavior."
--   2. Two tables now exist in this ownership graph that postdate the
--      original plan: sales_quote_proposal_approval_requests (migration
--      147, D4's discount-approval gate) and sales_quote_proposal_questions
--      (migration 149, D16's client Q&A). Both are squarely part of the
--      "reachable from one quote detail page in one sitting" cluster the
--      plan's own §4 describes -- leaving them unscoped while everything
--      else is scoped would recreate exactly the "partial RLS is worse
--      than no RLS" risk the plan warns about. Both are included below.
--      approval_requests already carries its own workspace_id column
--      (no join needed); proposal_questions joins through proposal_id ->
--      sales_quote_proposals -> sales_quotes.
--   3. Four security-definer RPCs in this same cluster currently have
--      NO workspace-membership check on the caller at all, relying
--      entirely on RLS -- which they bypass by definition, being
--      security definer. RLS on the underlying tables does nothing to
--      protect these call paths. Confirmed by direct read, not assumed:
--        - request_or_send_quote_proposal_version() (migration 147) --
--          checks role (Sales/manager/admin) but never checks the
--          caller's workspace against the target quote's workspace.
--        - respond_to_proposal_approval_request() (migration 147) --
--          checks role (manager/admin) but never checks the caller's
--          workspace against the approval request's own workspace_id.
--        - get_quote_proposal_by_token() (migration 145) -- anon/token
--          path, never checks workspaces.status (T8 in the original
--          threat model, confirmed still unfixed).
--        - respond_to_quote_proposal() (migration 153, this session's
--          own earlier work) -- same T8 gap, plus its expiration-lookup
--          uses active_workspace_id() (the "exactly one workspace in the
--          whole database" transitional guard, migration 124) instead of
--          the specific quote's own already-resolved workspace_id --
--          this is fixed here using the value this function already
--          computes for the new suspended-workspace check, at zero added
--          risk.
--      All four are hardened below. request_or_send_quote_proposal_version
--      now uses the exact same resolve_caller_workspace_id() +
--      explicit-comparison pattern already proven correct and live in
--      create_project_from_quote() (migration 146) -- not a new pattern,
--      reusing the one this codebase already trusts for this exact
--      problem.
--   4. active_workspace_id() itself (migration 124) is NOT touched by
--      this migration. It is a deliberate, documented, transitional
--      fail-closed guard used by several OTHER RPCs (equipment recipe
--      save, project BOM replace, the legacy admin-role bridge, and the
--      share-link RPCs shared between Submittals and Proposals) precisely
--      because the tables THEY touch (equipment_types, projects,
--      project_submittals) do not have their own workspace_id yet --
--      that lands in later table groups (Projects; Documents/
--      Notifications/Storage). Replacing active_workspace_id() itself is
--      out of scope for a Clients+Sales-only migration; each remaining
--      call site should be retired individually as its own table group
--      gains real per-row workspace ownership, not all at once here.
--      Recorded as a running cross-cutting item, not silently dropped --
--      see PRODUCT_PHASE3_PLAN.md's companion tracking note.
--
-- Preserves current authorized same-workspace behavior throughout: with
-- exactly one real workspace in production today, every policy below
-- (is_workspace_member/is_active_workspace_member) evaluates to exactly
-- the same true/false outcome is_app_admin()/has_role()-gated logic
-- already produced pre-migration, for every current real user -- this is
-- provable because every current app_admins/app_user_roles user was
-- already migrated into workspace_members for that one workspace
-- (migration 115), and that workspace is active. No existing role
-- restriction (Sales/manager/admin on the two proposal-workflow RPCs,
-- requester-or-manager-or-admin on approval requests) is removed or
-- loosened -- the workspace predicate is added alongside every one of
-- them, per the plan's own T2 framing.
--
-- Confirm 155 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- New helper functions.
-- ============================================================

-- Same shape as is_workspace_member() (migration 115), plus the
-- workspace's own active status -- used for every INSERT/UPDATE/DELETE
-- policy below, matching the required denial test "suspended workspace
-- blocks writes." Reads remain available to a suspended workspace's own
-- members (is_workspace_member() alone, unchanged) -- only writes are
-- blocked. This mirrors resolve_caller_workspace_id()'s own three-way
-- distinction (no membership / suspended / ambiguous) at the row-policy
-- level instead of the single-workspace-resolution level.
create or replace function public.is_active_workspace_member(check_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = check_workspace_id
      and wm.user_id = auth.uid()
      and w.status = 'active'
  );
$$;

revoke execute on function public.is_active_workspace_member(uuid) from public;
grant execute on function public.is_active_workspace_member(uuid) to authenticated;

-- Child-table workspace resolvers. Each is security definer so it reads
-- its target table under the OWNER's privileges, not the calling role's
-- RLS-restricted view -- matching migration 115's own stated principle
-- ("no policy contains a raw subquery against an RLS-protected table"),
-- extended here to the one-level and two-level join shapes this table
-- group actually needs (PRODUCT_PHASE3_PLAN.md T5). Each returns NULL
-- (never raises) when the referenced parent row doesn't exist, so a
-- policy using one of these against a dangling/invalid id simply
-- evaluates is_workspace_member(null) = false rather than erroring --
-- correct fail-closed behavior for a bad or stale reference.

create or replace function public.sales_quote_owner_workspace_id(p_quote_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.sales_quotes where id = p_quote_id;
$$;

create or replace function public.sales_quote_location_owner_workspace_id(p_quote_location_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select q.workspace_id
  from public.sales_quote_locations l
  join public.sales_quotes q on q.id = l.quote_id
  where l.id = p_quote_location_id;
$$;

create or replace function public.sales_quote_proposal_owner_workspace_id(p_proposal_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select q.workspace_id
  from public.sales_quote_proposals p
  join public.sales_quotes q on q.id = p.quote_id
  where p.id = p_proposal_id;
$$;

revoke execute on function public.sales_quote_owner_workspace_id(uuid) from public;
revoke execute on function public.sales_quote_location_owner_workspace_id(uuid) from public;
revoke execute on function public.sales_quote_proposal_owner_workspace_id(uuid) from public;
grant execute on function public.sales_quote_owner_workspace_id(uuid) to authenticated;
grant execute on function public.sales_quote_location_owner_workspace_id(uuid) to authenticated;
grant execute on function public.sales_quote_proposal_owner_workspace_id(uuid) to authenticated;

-- ============================================================
-- Section 2 -- clients, sales_quotes: replace the wide-open "for all"
-- policy with four workspace-scoped policies each. The old policies are
-- dropped first -- leaving them in place alongside new ones would be a
-- no-op fix, since Postgres ORs every applicable policy together per
-- operation and a using(true) policy always wins that OR.
-- ============================================================

drop policy if exists "authenticated read clients" on public.clients;
drop policy if exists "authenticated write clients" on public.clients;

create policy "workspace members read clients"
  on public.clients for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert clients"
  on public.clients for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update clients"
  on public.clients for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete clients"
  on public.clients for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists "authenticated read sales_quotes" on public.sales_quotes;
drop policy if exists "authenticated write sales_quotes" on public.sales_quotes;

create policy "workspace members read sales_quotes"
  on public.sales_quotes for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert sales_quotes"
  on public.sales_quotes for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update sales_quotes"
  on public.sales_quotes for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete sales_quotes"
  on public.sales_quotes for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 3 -- one-level child tables (quote_id -> sales_quotes).
-- ============================================================

drop policy if exists "authenticated read sales_quote_locations" on public.sales_quote_locations;
drop policy if exists "authenticated write sales_quote_locations" on public.sales_quote_locations;

create policy "workspace members read sales_quote_locations"
  on public.sales_quote_locations for select to authenticated
  using (public.is_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members insert sales_quote_locations"
  on public.sales_quote_locations for insert to authenticated
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members update sales_quote_locations"
  on public.sales_quote_locations for update to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)))
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members delete sales_quote_locations"
  on public.sales_quote_locations for delete to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

drop policy if exists "authenticated read sales_quote_bom_lines" on public.sales_quote_bom_lines;
drop policy if exists "authenticated write sales_quote_bom_lines" on public.sales_quote_bom_lines;

create policy "workspace members read sales_quote_bom_lines"
  on public.sales_quote_bom_lines for select to authenticated
  using (public.is_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members insert sales_quote_bom_lines"
  on public.sales_quote_bom_lines for insert to authenticated
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members update sales_quote_bom_lines"
  on public.sales_quote_bom_lines for update to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)))
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members delete sales_quote_bom_lines"
  on public.sales_quote_bom_lines for delete to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

drop policy if exists "authenticated read sales_quote_intake_responses" on public.sales_quote_intake_responses;
drop policy if exists "authenticated write sales_quote_intake_responses" on public.sales_quote_intake_responses;

create policy "workspace members read sales_quote_intake_responses"
  on public.sales_quote_intake_responses for select to authenticated
  using (public.is_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members insert sales_quote_intake_responses"
  on public.sales_quote_intake_responses for insert to authenticated
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members update sales_quote_intake_responses"
  on public.sales_quote_intake_responses for update to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)))
  with check (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

create policy "workspace members delete sales_quote_intake_responses"
  on public.sales_quote_intake_responses for delete to authenticated
  using (public.is_active_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

-- ============================================================
-- Section 4 -- two-level child tables (quote_location_id ->
-- sales_quote_locations -> sales_quotes).
-- ============================================================

drop policy if exists "authenticated read sales_quote_location_images" on public.sales_quote_location_images;
drop policy if exists "authenticated write sales_quote_location_images" on public.sales_quote_location_images;

create policy "workspace members read sales_quote_location_images"
  on public.sales_quote_location_images for select to authenticated
  using (public.is_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members insert sales_quote_location_images"
  on public.sales_quote_location_images for insert to authenticated
  with check (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members update sales_quote_location_images"
  on public.sales_quote_location_images for update to authenticated
  using (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)))
  with check (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members delete sales_quote_location_images"
  on public.sales_quote_location_images for delete to authenticated
  using (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

drop policy if exists "authenticated read sales_quote_location_items" on public.sales_quote_location_items;
drop policy if exists "authenticated write sales_quote_location_items" on public.sales_quote_location_items;

create policy "workspace members read sales_quote_location_items"
  on public.sales_quote_location_items for select to authenticated
  using (public.is_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members insert sales_quote_location_items"
  on public.sales_quote_location_items for insert to authenticated
  with check (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members update sales_quote_location_items"
  on public.sales_quote_location_items for update to authenticated
  using (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)))
  with check (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

create policy "workspace members delete sales_quote_location_items"
  on public.sales_quote_location_items for delete to authenticated
  using (public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(quote_location_id)));

-- ============================================================
-- Section 5 -- sales_quote_proposals: SELECT only. No insert/update/
-- delete policy is added -- none has existed since migration 144, and
-- adding one now would grant a write capability that does not exist
-- today, the opposite of "preserve current behavior." All real writes
-- continue to go exclusively through the security-definer RPCs hardened
-- in Section 7 below.
-- ============================================================

drop policy if exists "authenticated read sales_quote_proposals" on public.sales_quote_proposals;

create policy "workspace members read sales_quote_proposals"
  on public.sales_quote_proposals for select to authenticated
  using (public.is_workspace_member(public.sales_quote_owner_workspace_id(quote_id)));

-- ============================================================
-- Section 6 -- the two tables added after the original Phase 3 plan was
-- written. Both SELECT-only, matching their existing no-direct-write
-- posture (writes go through their own RPCs, hardened in Section 7).
-- ============================================================

-- sales_quote_proposal_approval_requests already carries its own
-- workspace_id column (migration 147) -- no join needed. The existing
-- role-scoped policy (requester, or manager/admin) is preserved and
-- combined with the workspace check via AND, not replaced -- exactly
-- the "alongside, not instead of" pattern PRODUCT_PHASE3_PLAN.md's T2
-- calls for.
drop policy if exists "requester and manager/admin read proposal approval requests" on public.sales_quote_proposal_approval_requests;

create policy "workspace members: requester and manager/admin read proposal approval requests"
  on public.sales_quote_proposal_approval_requests for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      requested_by = auth.uid()
      or public.is_app_admin(auth.uid())
      or public.has_role('manager')
    )
  );

drop policy if exists "authenticated read proposal questions" on public.sales_quote_proposal_questions;

create policy "workspace members read proposal questions"
  on public.sales_quote_proposal_questions for select to authenticated
  using (public.is_workspace_member(public.sales_quote_proposal_owner_workspace_id(proposal_id)));

-- ============================================================
-- Section 7 -- RPC hardening. Every function below is security definer
-- and therefore bypasses every policy created above by definition --
-- RLS on the underlying tables does nothing to protect these call
-- paths. Each gets its own explicit workspace check, matching
-- PRODUCT_PHASE3_PLAN.md's T2/T6/T7/T8. Signatures are unchanged for
-- all four (CREATE OR REPLACE is safe -- no parameter or return-type
-- change), so no drop-then-create and no frontend change is needed.
-- ============================================================

-- get_quote_proposal_by_token: adds a suspended-workspace check,
-- mapped to the SAME 'unavailable' outcome already used for a
-- temporarily-disabled or permanently-revoked link (T8) -- an external
-- client sees no difference between "this link was disabled" and "this
-- company's workspace is suspended," which is the correct behavior:
-- nothing about a workspace's internal billing/operational status
-- should ever be observable from the public token-holder's side. Every
-- other branch, and the view-logging insert, is copied verbatim from
-- the current live definition (migration 145) -- no other behavior
-- changes.
create or replace function public.get_quote_proposal_by_token(share_token text)
returns table (
  outcome text,
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  responded_at timestamptz,
  approval_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_status text;
  v_expires_at timestamptz;
  v_id uuid;
  v_status text;
  v_version integer;
  v_content_snapshot jsonb;
  v_client_name text;
  v_responded_at timestamptz;
  v_approval_name text;
  v_outcome text;
  v_view_result text;
  v_workspace_status text;
begin
  select t.status, t.expires_at, p.id, p.status, p.version, p.content_snapshot, p.client_name, p.responded_at, p.approval_name
  into v_token_status, v_expires_at, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_responded_at, v_approval_name
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token and t.entity_type = 'sales_quote_proposal';

  if v_token_status is null then
    return query select 'invalid_token'::text, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  select w.status into v_workspace_status
  from public.sales_quote_proposals p
  join public.sales_quotes q on q.id = p.quote_id
  join public.workspaces w on w.id = q.workspace_id
  where p.id = v_id;

  if v_token_status = 'superseded' then
    v_outcome := 'superseded';
    v_view_result := 'superseded';
  elsif v_token_status = 'temporarily_disabled' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  elsif v_token_status = 'permanently_revoked' then
    v_outcome := 'unavailable';
    v_view_result := 'revoked';
  elsif v_expires_at is not null and v_expires_at <= now() then
    v_outcome := 'expired';
    v_view_result := 'expired';
  elsif coalesce(v_workspace_status, 'active') <> 'active' then
    v_outcome := 'unavailable';
    v_view_result := 'disabled';
  else
    v_outcome := 'found';
    v_view_result := 'success';
  end if;

  begin
    insert into public.share_link_views (token, entity_type, entity_id, result)
    values (share_token, 'sales_quote_proposal', v_id, v_view_result);
  exception when others then
    null;
  end;

  if v_outcome <> 'found' then
    return query select v_outcome, null::uuid, null::text, null::integer, null::jsonb, null::text, null::timestamptz, null::text;
    return;
  end if;

  return query select 'found'::text, v_id, v_status, v_version, v_content_snapshot, v_client_name, v_responded_at, v_approval_name;
end;
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
revoke execute on function public.get_quote_proposal_by_token(text) from authenticated;
grant execute on function public.get_quote_proposal_by_token(text) to anon;

-- respond_to_quote_proposal: same suspended-workspace guard as above
-- (mapped to 'unavailable', same reasoning), added right after the
-- token lookup and before any status branch. Also replaces the
-- expiration-lookup's use of active_workspace_id() (the "exactly one
-- workspace in the whole database" transitional guard) with this
-- proposal's own already-resolved quote workspace_id -- a strict
-- correctness improvement (this call path is reachable by an anonymous
-- customer, so it must never depend on a guard designed for
-- authenticated-staff bridge functions) made at zero added risk, since
-- the value is already being computed for the new check directly above
-- it. No other logic changes from the current live definition
-- (migration 153).
create or replace function public.respond_to_quote_proposal(
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
  target_workspace_id uuid;
  target_workspace_status text;
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

  select q.workspace_id into target_workspace_id
  from public.sales_quotes q where q.id = target_quote_id;

  select w.status into target_workspace_status
  from public.workspaces w where w.id = target_workspace_id;

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
  if coalesce(target_workspace_status, 'active') <> 'active' then
    return query select 'unavailable'::text, null::text, null::timestamptz, null::text, null::integer;
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
      where workspace_id = target_workspace_id
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

-- Grant posture unchanged from migration 153: service-role only, reached
-- via api/respond-to-proposal.js. Same signature as migration 153's
-- definition, so no drop is required here -- CREATE OR REPLACE is safe.
revoke all on function public.respond_to_quote_proposal(text, text, text, text, text, uuid[]) from public, anon, authenticated;

-- request_or_send_quote_proposal_version: adds an explicit
-- caller-workspace-vs-quote-workspace check, using the exact same
-- resolve_caller_workspace_id() + comparison pattern already proven
-- correct and live in create_project_from_quote() (migration 146) --
-- not inventing a new pattern. Placed immediately after the role check
-- and the quote lookup, before anything else runs. This also replaces
-- the settings-lookup's use of active_workspace_id() with the quote's
-- own already-resolved workspace_id (v_workspace_id), which the
-- function already declares and now sets directly from the quote row
-- instead of from the single-workspace-database guard -- consistent
-- with the respond_to_quote_proposal fix above, and correct for the
-- same reason (this workspace_id describes the QUOTE being acted on,
-- not "whichever workspace happens to be the only one right now").
create or replace function public.request_or_send_quote_proposal_version(
  p_quote_id uuid,
  p_content_snapshot jsonb,
  p_client_name text,
  p_client_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_workspace_id uuid;
  v_caller_workspace_id uuid;
  v_quote record;
  v_settings record;
  v_gate_applies boolean;
  v_request_id uuid;
  v_send_result record;
begin
  if not (public.is_app_admin(v_actor_id) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may create and send a proposal version.' using errcode = 'EC001';
  end if;

  select * into v_quote from public.sales_quotes where id = p_quote_id;
  if not found then
    raise exception 'This quote could not be found.' using errcode = 'EC003';
  end if;

  -- Phase 3 containment: the caller must be an active member of THIS
  -- quote's own workspace, not merely pass a global role check. Same
  -- error-code convention (EC002) already used by create_project_from_
  -- quote() for the identical cross-workspace-attempt case.
  v_caller_workspace_id := public.resolve_caller_workspace_id();
  if v_quote.workspace_id is distinct from v_caller_workspace_id then
    raise exception 'This quote does not belong to your workspace.' using errcode = 'EC002';
  end if;

  v_workspace_id := v_quote.workspace_id;
  v_actor_email := (select email from auth.users where id = v_actor_id);

  select * into v_settings from public.workspace_sales_approval_settings where workspace_id = v_workspace_id;
  if not found then
    insert into public.workspace_sales_approval_settings (workspace_id) values (v_workspace_id)
      on conflict (workspace_id) do nothing;
    select * into v_settings from public.workspace_sales_approval_settings where workspace_id = v_workspace_id;
  end if;

  v_gate_applies := coalesce(v_settings.discount_approval_enabled, false)
    and v_quote.discount_percent > v_settings.discount_approval_threshold_percent;

  if not v_gate_applies then
    select * into v_send_result
      from public.create_and_send_quote_proposal_version(p_quote_id, p_content_snapshot, p_client_name, p_client_email);
    return jsonb_build_object(
      'outcome', 'sent',
      'proposal_id', v_send_result.proposal_id,
      'token', v_send_result.token
    );
  end if;

  insert into public.sales_quote_proposal_approval_requests (
    quote_id, workspace_id, content_snapshot, client_name, client_email,
    discount_percent, threshold_percent, requested_by, requested_by_email
  ) values (
    p_quote_id, v_workspace_id, coalesce(p_content_snapshot, '{}'::jsonb), p_client_name, p_client_email,
    v_quote.discount_percent, v_settings.discount_approval_threshold_percent, v_actor_id, v_actor_email
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'outcome', 'pending_approval',
    'approval_request_id', v_request_id,
    'discount_percent', v_quote.discount_percent,
    'threshold_percent', v_settings.discount_approval_threshold_percent
  );
end;
$$;

revoke all on function public.request_or_send_quote_proposal_version(uuid, jsonb, text, text) from public;
revoke execute on function public.request_or_send_quote_proposal_version(uuid, jsonb, text, text) from anon;
grant execute on function public.request_or_send_quote_proposal_version(uuid, jsonb, text, text) to authenticated;

-- respond_to_proposal_approval_request: adds the same
-- caller-workspace-vs-request-workspace check, using
-- v_request.workspace_id directly (already a column on
-- sales_quote_proposal_approval_requests, no join needed) instead of
-- re-deriving it. Placed after the row is locked (for update) and its
-- pending status is confirmed, before any decision branch executes.
create or replace function public.respond_to_proposal_approval_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_caller_workspace_id uuid;
  v_request record;
  v_send_result record;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be either ''approved'' or ''rejected''.' using errcode = 'EC001';
  end if;

  if not (public.is_app_admin(v_actor_id) or public.has_role('manager')) then
    raise exception 'Only a Sales Manager or an admin may approve or reject a proposal send request.' using errcode = 'EC001';
  end if;

  select * into v_request from public.sales_quote_proposal_approval_requests where id = p_request_id for update;
  if not found then
    raise exception 'This approval request could not be found.' using errcode = 'EC003';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request was already %.', v_request.status using errcode = 'EC006';
  end if;

  -- Phase 3 containment: same EC002 convention as request_or_send_quote_
  -- proposal_version() above and create_project_from_quote() (migration
  -- 146) for an identical cross-workspace-attempt case.
  v_caller_workspace_id := public.resolve_caller_workspace_id();
  if v_request.workspace_id is distinct from v_caller_workspace_id then
    raise exception 'This approval request does not belong to your workspace.' using errcode = 'EC002';
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  if p_decision = 'rejected' then
    update public.sales_quote_proposal_approval_requests
      set status = 'rejected', reviewed_by = v_actor_id, reviewed_by_email = v_actor_email,
        reviewed_at = now(), review_note = p_note
      where id = p_request_id;
    return jsonb_build_object('outcome', 'rejected');
  end if;

  select * into v_send_result from public.create_and_send_quote_proposal_version(
    v_request.quote_id, v_request.content_snapshot, v_request.client_name, v_request.client_email
  );

  update public.sales_quote_proposal_approval_requests
    set status = 'approved', reviewed_by = v_actor_id, reviewed_by_email = v_actor_email,
      reviewed_at = now(), review_note = p_note, resulting_proposal_id = v_send_result.proposal_id
    where id = p_request_id;

  return jsonb_build_object(
    'outcome', 'approved',
    'proposal_id', v_send_result.proposal_id,
    'token', v_send_result.token
  );
end;
$$;

revoke all on function public.respond_to_proposal_approval_request(uuid, text, text) from public;
revoke execute on function public.respond_to_proposal_approval_request(uuid, text, text) from anon;
grant execute on function public.respond_to_proposal_approval_request(uuid, text, text) to authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - active_workspace_id() itself, and every OTHER RPC that still
--     depends on it (equipment recipe save, project BOM replace, the
--     legacy admin-role bridge, and the share-link RPCs' SUBMITTAL-side
--     branches) -- see this file's header for why. Tracked as a running
--     cross-cutting item, revisited as each remaining table group ships
--     its own workspace_id.
--   - create_project_from_quote() -- already correct (confirmed by
--     direct read: it already resolves and compares the caller's
--     workspace against the source quote's workspace, migration 146).
--     Not touched because it needs no fix, not because it was skipped.
--   - sales_quote_ref_counters -- a shared infrastructure/counter table
--     (keyed by year only, no quote_id), not part of the ownership
--     graph -- per-workspace reference numbering is later table-group
--     territory (workspace-scoped uniqueness), not this migration's job.
--   - proposal_template_sections, public_share_tokens -- confirmed out
--     of scope by the original plan (§4) and unaffected by anything
--     found during revalidation: the former is intentionally
--     shared/global, the latter is shared infrastructure with
--     Submittals and already narrowed to RPC-only writes (migration
--     144) with its own untouched, workspace-agnostic-by-design read
--     policy.
--   - Storage bucket policies (sales-quote-images) -- a separate, later
--     phase per the plan's own §4/T13, not this migration's job.
-- ============================================================

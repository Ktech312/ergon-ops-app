-- Sales Batch 5 (D4, approved 2026-09-15): a configurable, per-workspace
-- discount-approval gate for sending a Quote Proposal. Disabled by
-- default. When enabled, sending a proposal whose quote's discount_percent
-- exceeds the workspace-configured threshold (default 10%) requires a
-- Sales Manager or workspace admin to approve it first -- PM has no
-- approval authority here, matching the explicit instruction, and Sales
-- (the role that sends proposals in the first place) cannot approve its
-- own request either, since only 'manager'/admin ever satisfy the review
-- check below. Margin-based approval is explicitly deferred until cost
-- and margin calculations are formally defined -- this gate is
-- discount-percent only.
--
-- Reuses the STRUCTURAL propose/review/approve pattern from
-- catalog_price_change_requests (migration 046), as instructed -- a
-- requests table with pending/approved/rejected status and requester/
-- reviewer tracking. It does NOT reuse that table's own has_role()/
-- app_user_roles authorization mechanism for a different reason: this
-- gate sits directly on top of create_and_send_quote_proposal_version()
-- (migration 140), which is itself already authorized via
-- has_role('sales')/has_role('manager')/is_app_admin() (not the newer
-- workspace_member_roles pattern create_project_from_quote() uses) --
-- matching the function this migration actually wraps keeps one
-- consistent authorization story for this specific call chain, rather
-- than mixing two different role systems in one feature. has_role() was
-- hardened for search_path/grants in migration 135 and is safe to call.
--
-- Design, three parts:
--   1. workspace_sales_approval_settings -- one row per workspace,
--      toggle + threshold, editable through Admin settings (no code
--      deploy required for a future customer to change it). Modeled
--      directly on workspace_share_link_settings (migration 137): same
--      shape, same "authenticated read, admin write" RLS split, same
--      grant-layer correction migration 141 already taught this repo to
--      apply from the start rather than as a follow-up.
--   2. sales_quote_proposal_approval_requests -- one row per pending/
--      resolved approval, storing the FULL content_snapshot/client_name/
--      client_email the request was made with (needed later at approval
--      time, since sending happens asynchronously once approved). RLS
--      enabled with a read-only policy (requester or manager/admin) and
--      ZERO write policies -- every write goes through the two RPCs
--      below, matching this repo's own "close direct-write bypasses"
--      discipline (Queue C2.7) applied from day one instead of as a
--      later fix.
--   3. Two RPCs:
--      - request_or_send_quote_proposal_version(): the new sole entry
--        point for Create & Send -- wraps create_and_send_quote_proposal_
--        version() UNCHANGED (not a single line of its already-hardened,
--        already-tested body is touched) and calls it directly when the
--        gate doesn't apply, or creates a pending request instead when it
--        does. create_and_send_quote_proposal_version()'s own direct
--        EXECUTE grant to authenticated is revoked below, closing the
--        obvious bypass (send the proposal directly, skip the gate) --
--        its nested call from this wrapper is unaffected, since both
--        functions execute as their shared owner regardless of that
--        revoke, the same validated pattern already used for
--        guard_workspace_id_mutation()/create_project_channel()
--        (migrations 117/128).
--      - respond_to_proposal_approval_request(): Sales Manager/admin
--        approves (sends the stored snapshot via the untouched original
--        function) or rejects (no proposal is ever created). Row-locked
--        (`for update`) against a concurrent double-review race.
--
-- Deliberately NOT done by this migration: no notification is fired when
-- a request is created or reviewed. Reusing migration 024's notification
-- engine would require widening notification_rules.event_type's CHECK
-- constraint -- and this repo has already hit real production failures
-- from reconstructing that constraint's allow-list from old migration
-- files instead of the live table's actual current values (documented at
-- length in HANDOFF.md). Without live database access this session to
-- confirm the current list safely, adding notifications here would repeat
-- a known mistake -- left as a small, independent, low-risk follow-up
-- once E can confirm the live event_type list. A pending request is still
-- fully visible without it: the requester sees "Pending Sales Manager
-- approval" on the quote, and a Sales Manager/admin sees it in the new
-- Approval Requests queue.
--
-- Confirm 147 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- 1. Workspace-level settings.
-- ============================================================

create table if not exists public.workspace_sales_approval_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  discount_approval_enabled boolean not null default false,
  discount_approval_threshold_percent numeric(5,2) not null default 10
    check (discount_approval_threshold_percent >= 0 and discount_approval_threshold_percent <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.workspace_sales_approval_settings enable row level security;

create policy "authenticated read workspace_sales_approval_settings"
  on public.workspace_sales_approval_settings for select to authenticated using (true);

create policy "admin write workspace_sales_approval_settings"
  on public.workspace_sales_approval_settings for all to authenticated
  using (public.is_app_admin(auth.uid()))
  with check (public.is_app_admin(auth.uid()));

-- Seed exactly one row for today's one real active workspace -- mirrors
-- migration 137's own precedent. Silently skipped if no active workspace
-- exists yet; created lazily by the RPC below if genuinely still missing.
insert into public.workspace_sales_approval_settings (workspace_id)
select id from public.workspaces where status = 'active'
on conflict (workspace_id) do nothing;

-- Grant-layer correction applied from the start, not as a migration-141-
-- style follow-up: this project's default privileges would otherwise
-- auto-grant authenticated broad table access regardless of what's
-- explicitly written here.
revoke all on table public.workspace_sales_approval_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_sales_approval_settings to authenticated;

-- ============================================================
-- 2. Approval requests. RLS read-only -- every write goes through the
--    two RPCs below.
-- ============================================================

create table if not exists public.sales_quote_proposal_approval_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_snapshot jsonb not null,
  client_name text not null,
  client_email text not null,
  discount_percent numeric(5,2) not null,
  threshold_percent numeric(5,2) not null,
  requested_by uuid not null references auth.users(id),
  requested_by_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_by_email text,
  reviewed_at timestamptz,
  review_note text,
  resulting_proposal_id uuid references public.sales_quote_proposals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_approval_requests_quote on public.sales_quote_proposal_approval_requests(quote_id);
create index if not exists idx_proposal_approval_requests_status on public.sales_quote_proposal_approval_requests(status);

alter table public.sales_quote_proposal_approval_requests enable row level security;

create policy "requester and manager/admin read proposal approval requests"
  on public.sales_quote_proposal_approval_requests for select to authenticated
  using (
    requested_by = auth.uid()
    or public.is_app_admin(auth.uid())
    or public.has_role('manager')
  );

revoke all on table public.sales_quote_proposal_approval_requests from public, anon, authenticated;
grant select on table public.sales_quote_proposal_approval_requests to authenticated;

-- ============================================================
-- 3a. The new sole entry point for Create & Send.
-- ============================================================

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

  v_workspace_id := public.active_workspace_id();
  v_actor_email := (select email from auth.users where id = v_actor_id);

  select * into v_settings from public.workspace_sales_approval_settings where workspace_id = v_workspace_id;
  if not found then
    -- Lazily seed a default (disabled) settings row if one genuinely
    -- doesn't exist yet -- mirrors migration 137's own "created lazily
    -- the first time it's actually needed" precedent.
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

-- Close the direct-call bypass now that the gated wrapper above is the
-- sanctioned path -- see this migration's own header for why the nested
-- call from the wrapper above is unaffected by this revoke.
revoke execute on function public.create_and_send_quote_proposal_version(uuid, jsonb, text, text) from authenticated;

-- ============================================================
-- 3b. Sales Manager / admin review.
-- ============================================================

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

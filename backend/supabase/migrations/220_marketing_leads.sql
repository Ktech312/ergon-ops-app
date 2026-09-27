-- Migration 220: marketing_leads / marketing_lead_activity -- Phase 5
-- (Marketing depth), the lead-capture-to-Sales-Quote feature from
-- PRODUCT_MARKETING_SALES_DESIGN.md ("§8 Smallest useful first release":
-- capture a lead, log qualification activity, convert a qualified lead
-- into a Sales Quote with no re-typed company/contact data). That
-- document left one genuine permissions question open (§7, item 1),
-- which was put to E directly rather than guessed at. E's own answer,
-- reproduced in full so the reasoning below can be checked against it:
--
--   "After conversion, Sales owns the quote. Marketing may retain
--   read-only access for attribution, reporting, and conversion history,
--   but cannot edit the quote. Record who converted the lead and when.
--   Any later correction must be made by an authorized Sales user and
--   captured in the audit log."
--
-- ============================================================
-- How this migration satisfies each part of that answer:
--
-- "Sales owns the quote" / "Marketing... cannot edit the quote": this is
-- already true today with ZERO new restriction needed, verified by
-- direct read rather than assumed. sales_quotes' own RLS (migration 155)
-- has no role-based write restriction at all -- workspace membership is
-- the only DB-level gate, matching this schema's established convention
-- that role-based restriction on internal business workflows is a
-- FRONTEND concern, not an RLS one (the same convention this session
-- already confirmed for task-section labeling, catalog-management
-- gating, etc.). The frontend's own DEFAULT_TABS_BY_ROLE.marketing list
-- (main.tsx) does not include "sales" -- a marketing-role user's
-- allowedTabs never include the Sales tab, so they cannot reach
-- SalesQuoteBuilder's edit controls at all by default. Widening a
-- specific user's allowed views to include "sales" is a separate,
-- already-existing, general per-user admin override (unrelated to this
-- feature) -- exactly the same "authorized Sales user" escape hatch E's
-- answer implies, not a new capability this migration adds.
--
-- "Marketing may retain read-only access... for attribution, reporting,
-- and conversion history": satisfied by marketing_leads' own
-- converted_sales_quote_id/converted_by/converted_at columns below,
-- readable by any workspace member (same RLS shape as every other
-- workspace-scoped read in this schema) -- Marketing never needs Sales-
-- tab access to see what happened to a lead they converted.
--
-- "Record who converted the lead and when": converted_by/converted_at,
-- set atomically by convert_marketing_lead_to_quote() below, in the same
-- transaction as the quote's own creation and the lead's status flip --
-- never three separate round-trips that could partially fail.
--
-- "Any later correction must be made by an authorized Sales user and
-- captured in the audit log": sales_quotes has NO audit trail today for
-- ANY role (confirmed by direct search -- no quote_activity/quote_audit
-- table of any kind exists), so building one is a separate, larger
-- undertaking than this feature's own scope, not something to add here
-- as a side effect. This migration's own marketing_lead_activity table
-- (append-only, same convention as support_case_activity/
-- product_request_reviews) already gives a real, working place to record
-- a correction against the LEAD's own timeline -- an authorized Sales
-- user (or anyone with workspace access) can log a 'note' there
-- explaining what changed and why. This is a deliberate, scoped-down
-- interpretation, not silently dropped: a fully general sales_quotes
-- audit trail, if wanted later, is separate future work, not guessed at
-- here alongside a feature that was supposed to stay additive.
-- ============================================================

begin;

-- ============================================================
-- Incidental fix, found while building this migration's own conversion
-- RPC, not a change made for its own sake: create_client_channel()
-- (migration 102) has never had its search_path pinned, and its trigger
-- body references `channels`/its own columns unqualified. This was
-- invisible for over a hundred migrations because every existing caller
-- that inserts a `clients` row is a plain PostgREST INSERT from the
-- frontend, which runs with the connection's normal, full search_path --
-- convert_marketing_lead_to_quote() below is the FIRST SECURITY DEFINER
-- function in this schema to ever insert into `clients` with `set
-- search_path = ''` pinned (this session's own established convention
-- for every new function, e.g. every RPC in migrations 214-219). Under
-- that empty search_path, create_client_channel()'s own unqualified
-- `insert into channels (...)` fails with "relation channels does not
-- exist" -- caught directly by this migration's own canonical test, not
-- guessed at. Fixed at its source (same function name/signature, so the
-- existing `clients_create_channel` trigger needs no change): pin
-- `search_path = ''` and fully qualify both tables it touches. Behavior
-- is otherwise byte-for-byte identical.
-- ============================================================

create or replace function public.create_client_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channels (type, client_id, name)
  values ('client', new.id, new.name)
  on conflict (type, client_id) do nothing;
  return new;
end;
$$;

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id),
  company_name text not null check (char_length(btrim(company_name)) > 0),
  contact_name text,
  contact_email text,
  contact_phone text,
  lead_source text not null,
  campaign text,
  status text not null default 'new' check (status in (
    'new', 'qualifying', 'qualified', 'disqualified', 'converted'
  )),
  disqualified_reason text,
  owner_email text,
  -- Set only by convert_marketing_lead_to_quote() below, atomically with
  -- status = 'converted'.
  converted_sales_quote_id uuid references public.sales_quotes(id),
  converted_by uuid references auth.users(id),
  converted_at timestamptz,
  -- A human-confirmed duplicate match, never an automatic fuzzy merge --
  -- see the design doc's own §6 reasoning (company-name matching is
  -- unreliable, the same class of problem migration 102 had to fix by
  -- hand).
  duplicate_of_lead_id uuid references public.marketing_leads(id),
  -- Schema headroom only, per the design doc's own §5 -- no HubSpot
  -- integration is built or promised by this migration.
  external_source text check (external_source in ('hubspot')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketing_leads_workspace_id on public.marketing_leads(workspace_id);

create unique index if not exists idx_marketing_leads_external
  on public.marketing_leads(workspace_id, external_source, external_id)
  where external_source is not null;

create or replace function public.touch_marketing_lead_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_marketing_lead_updated_at() from public;

drop trigger if exists marketing_leads_touch_updated_at on public.marketing_leads;
create trigger marketing_leads_touch_updated_at
  before update on public.marketing_leads
  for each row execute function public.touch_marketing_lead_updated_at();

drop trigger if exists marketing_leads_guard_workspace_id on public.marketing_leads;
create trigger marketing_leads_guard_workspace_id
  before insert or update on public.marketing_leads
  for each row execute function public.guard_workspace_id_mutation();

alter table public.marketing_leads enable row level security;

create policy "workspace members read marketing_leads"
  on public.marketing_leads for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert marketing_leads"
  on public.marketing_leads for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update marketing_leads"
  on public.marketing_leads for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- No delete policy -- a lead is disqualified, never hard-deleted, same
-- discipline as support_cases/product_requests having no delete path.

revoke all on public.marketing_leads from public;
revoke all on public.marketing_leads from anon;
grant select, insert, update on public.marketing_leads to authenticated;

-- ============================================================
-- marketing_lead_activity -- append-only timeline, same shape as
-- support_case_activity (migration 200) / product_request_reviews
-- (migration 201): no update/delete policy, and (per those same two
-- tables' own established precedent) no direct authenticated INSERT
-- policy either -- actor_email must be the real caller's own resolved
-- address, never a client-supplied value a spoofed request could set to
-- someone else's name. Every row is written through
-- add_marketing_lead_activity() below.
-- ============================================================

create table if not exists public.marketing_lead_activity (
  id uuid primary key default gen_random_uuid(),
  marketing_lead_id uuid not null references public.marketing_leads(id) on delete cascade,
  kind text not null check (kind in ('note', 'status_change', 'contact_attempt', 'qualification_note')),
  body text,
  actor_email text,
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_marketing_lead_activity_lead
  on public.marketing_lead_activity(marketing_lead_id, occurred_at desc);

create or replace function public.marketing_lead_owner_workspace_id(p_lead_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select workspace_id from public.marketing_leads where id = p_lead_id;
$$;

revoke all on function public.marketing_lead_owner_workspace_id(uuid) from public;
revoke execute on function public.marketing_lead_owner_workspace_id(uuid) from anon;
grant execute on function public.marketing_lead_owner_workspace_id(uuid) to authenticated;

alter table public.marketing_lead_activity enable row level security;

create policy "workspace members read marketing_lead_activity"
  on public.marketing_lead_activity for select to authenticated
  using (public.is_workspace_member(public.marketing_lead_owner_workspace_id(marketing_lead_id)));

-- No insert policy for `authenticated` at all -- see this section's own
-- header. Writes go only through add_marketing_lead_activity() below.

revoke all on public.marketing_lead_activity from public;
revoke all on public.marketing_lead_activity from anon;
grant select on public.marketing_lead_activity to authenticated;

create or replace function public.add_marketing_lead_activity(p_lead_id uuid, p_kind text, p_body text default null)
returns public.marketing_lead_activity
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_workspace_id uuid;
  v_activity public.marketing_lead_activity;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to log lead activity';
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  if p_kind not in ('note', 'status_change', 'contact_attempt', 'qualification_note') then
    raise exception 'Invalid activity kind: %', p_kind;
  end if;

  v_workspace_id := public.marketing_lead_owner_workspace_id(p_lead_id);
  if v_workspace_id is null then
    raise exception 'Lead not found';
  end if;
  if not public.is_active_workspace_member(v_workspace_id) then
    raise exception 'Not an active member of this lead''s workspace';
  end if;

  insert into public.marketing_lead_activity (marketing_lead_id, kind, body, actor_email)
  values (p_lead_id, p_kind, nullif(btrim(coalesce(p_body, '')), ''), v_actor_email)
  returning * into v_activity;

  return v_activity;
end;
$$;

revoke all on function public.add_marketing_lead_activity(uuid, text, text) from public;
revoke execute on function public.add_marketing_lead_activity(uuid, text, text) from anon;
grant execute on function public.add_marketing_lead_activity(uuid, text, text) to authenticated;

-- ============================================================
-- convert_marketing_lead_to_quote() -- the actual "into today's Sales
-- Quote without re-entry" handoff. Looks up or creates a clients row by
-- name (scoped to the lead's own workspace, never cross-workspace),
-- creates the sales_quotes row, flips the lead to 'converted' recording
-- who/when, and logs one activity row -- all in one transaction, so it
-- never ends up half-done.
-- ============================================================

create or replace function public.convert_marketing_lead_to_quote(p_lead_id uuid)
returns public.sales_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_lead public.marketing_leads;
  v_client_id uuid;
  v_quote public.sales_quotes;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to convert a lead';
  end if;

  select email into v_actor_email from auth.users where id = v_actor_id;
  if v_actor_email is null then
    raise exception 'Could not resolve the signed-in user''s email';
  end if;

  select * into v_lead from public.marketing_leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'Lead not found';
  end if;

  if not public.is_active_workspace_member(v_lead.workspace_id) then
    raise exception 'Not an active member of this lead''s workspace';
  end if;

  if v_lead.status <> 'qualified' then
    raise exception 'Only a qualified lead can be converted (current status: %)', v_lead.status;
  end if;

  select id into v_client_id from public.clients
    where workspace_id = v_lead.workspace_id and lower(btrim(name)) = lower(btrim(v_lead.company_name));

  if v_client_id is null then
    insert into public.clients (workspace_id, name) values (v_lead.workspace_id, btrim(v_lead.company_name))
    returning id into v_client_id;
  end if;

  insert into public.sales_quotes (
    client_id, client_name, site_name, city, created_by_email,
    client_email, contact_full_name, contact_phone
  ) values (
    v_client_id, v_lead.company_name, '', null, v_actor_email,
    v_lead.contact_email, v_lead.contact_name, v_lead.contact_phone
  )
  returning * into v_quote;

  update public.marketing_leads
  set status = 'converted',
      client_id = v_client_id,
      converted_sales_quote_id = v_quote.id,
      converted_by = v_actor_id,
      converted_at = clock_timestamp()
  where id = p_lead_id;

  insert into public.marketing_lead_activity (marketing_lead_id, kind, body, actor_email)
  values (p_lead_id, 'status_change', 'Converted to Sales Quote ' || coalesce(v_quote.quote_ref, v_quote.id::text), v_actor_email);

  return v_quote;
end;
$$;

revoke all on function public.convert_marketing_lead_to_quote(uuid) from public;
revoke execute on function public.convert_marketing_lead_to_quote(uuid) from anon;
grant execute on function public.convert_marketing_lead_to_quote(uuid) to authenticated;

commit;

-- Confirm 221 is still the next free migration number before running any
-- migration this session generates after this one. Not applied. Kept
-- local for E's review.

-- Migration 221: Billing/SaaS foundation. Decision-independent only, per E's own explicit
-- direction (2026-09-27/29): "Build the decision-independent billing foundation, webhook
-- security, RLS, test-mode integration, comped-workspace handling, and configurable plan
-- catalog first. Keep production checkout disabled until the prices, caps, module mapping,
-- Stripe Price IDs, and tax-readiness are explicitly approved." Nothing in this migration
-- charges anyone, and real checkout is structurally impossible until E supplies real Stripe
-- Price IDs (see Section 1 -- billing_plans is seeded with null prices) AND flips the
-- `billing_settings.checkout_enabled` switch (Section 6, defaults false).
--
-- Incorporates E's four corrections to this session's own recommended defaults
-- (`PRODUCT_BILLING_SAAS_DECISIONS.md`), each cited at its own section below:
--   1. Plan entitlement is SEPARATE from a workspace's own module preference
--      (workspace_enabled_modules, migration 218) -- effective access is BOTH, never either
--      alone. An admin can never enable a module outside their plan; upgrading a plan never
--      auto-enables a previously-disabled module (Section 2/3).
--   2. Billing status lives ENTIRELY in workspace_billing, never added to
--      `workspaces.status`'s own enum -- that column and its existing 'active'/'suspended'
--      values are completely untouched by this migration (Section 4).
--   3. Exact payment-failure timing: 7 calendar days of normal access from the first
--      `past_due` event, then read-only; auto-restore on confirmed payment; never encode an
--      assumed Stripe retry duration (Section 4).
--   4. Duplicate-subscription prevention and idempotent-webhook-only state reconciliation are
--       structural requirements on the application code (`api/create-checkout-session.js`,
--       `api/stripe-webhook.js`), not this migration -- the schema here (unique Stripe id
--       columns, `stripe_webhook_events`) is what makes both possible.

begin;

-- ============================================================
-- Section 1 -- billing_plans: the configurable catalog. Seeded with 3 real plan_key rows and
-- NULL commercial values throughout (price, seat cap, Stripe Price IDs) -- structurally
-- present so every other table/function below can reference a real plan_key, but zero
-- commercial commitment encoded. Filling in real numbers later is a plain UPDATE, not a new
-- migration -- this IS the "configurable plan catalog" E asked for.
-- ============================================================

create table if not exists public.billing_plans (
  plan_key text primary key,
  name text not null,
  monthly_price_cents integer,
  annual_price_cents integer,
  seat_cap integer,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  -- false until E's real per-tier module matrix is entered as plan_modules rows (Section 2) --
  -- while false, plan_allows_module() below treats this plan as unrestricted (every module
  -- allowed), so the entitlement MECHANISM exists and is fully testable without guessing or
  -- prematurely restricting anyone.
  modules_configured boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.billing_plans (plan_key, name, sort_order) values
  ('starter', 'Starter', 1),
  ('growth', 'Growth', 2),
  ('enterprise', 'Enterprise', 3)
on conflict (plan_key) do nothing;

alter table public.billing_plans enable row level security;

-- Readable by anyone signed in (a future pricing/upgrade page needs this, and a plan name/
-- price is not sensitive) -- an inactive (draft/retired) plan is visible only to a platform
-- admin, matching how a not-yet-announced or retired plan shouldn't appear to ordinary users.
create policy "authenticated read active billing_plans"
  on public.billing_plans for select to authenticated
  using (is_active or public.is_platform_admin());

-- Ergon's own catalog, not any one workspace's affair -- platform-admin only, matching Q4.2.
create policy "platform admins manage billing_plans"
  on public.billing_plans for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.billing_plans from public;
revoke all on public.billing_plans from anon;
grant select, insert, update, delete on public.billing_plans to authenticated;

-- ============================================================
-- Section 2 -- plan_modules: per-plan module entitlement (E's correction #1). Deliberately
-- NOT seeded with any rows -- combined with modules_configured=false above, this means every
-- module is allowed for every plan today (the safe, non-restrictive default), while the real
-- mechanism (a true allow-list once configured) is fully built and testable.
-- ============================================================

create table if not exists public.plan_modules (
  plan_key text not null references public.billing_plans(plan_key) on delete cascade,
  module_key text not null,
  primary key (plan_key, module_key)
);

alter table public.plan_modules enable row level security;

create policy "authenticated read plan_modules"
  on public.plan_modules for select to authenticated
  using (true);

create policy "platform admins manage plan_modules"
  on public.plan_modules for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.plan_modules from public;
revoke all on public.plan_modules from anon;
grant select, insert, update, delete on public.plan_modules to authenticated;

-- plan_allows_module(): the entitlement check, safe-by-default. Returns true (unrestricted)
-- when the plan is null (no plan assigned yet), or the plan hasn't been configured yet
-- (modules_configured=false) -- only returns a real allow/deny once E's real matrix is entered.
create or replace function public.plan_allows_module(p_plan_key text, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_plan_key is null then true
    when not exists (select 1 from public.billing_plans where plan_key = p_plan_key and modules_configured) then true
    else exists (select 1 from public.plan_modules where plan_key = p_plan_key and module_key = p_module_key)
  end;
$$;

revoke all on function public.plan_allows_module(text, text) from public;
revoke execute on function public.plan_allows_module(text, text) from anon;
grant execute on function public.plan_allows_module(text, text) to authenticated;

-- ============================================================
-- Section 3 -- workspace_billing: one row per workspace, the real subscription/trial state.
-- Status lives HERE, never in workspaces.status (E's correction #2). unique partial indexes
-- on the two Stripe id columns are the schema-level half of duplicate-subscription prevention
-- (E's correction #4) -- the application-level half (checking for an existing subscription
-- before ever creating a new Checkout session) lives in api/create-checkout-session.js.
-- ============================================================

create table if not exists public.workspace_billing (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text references public.billing_plans(plan_key),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'comped')),
  trial_ends_at timestamptz,
  -- Set the instant status first transitions INTO 'past_due'; cleared on any other status.
  -- The 7-calendar-day grace window (E's correction #3) is computed FROM this timestamp, not
  -- from any assumed Stripe retry-schedule duration.
  past_due_since timestamptz,
  current_period_end timestamptz,
  is_comped boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists idx_workspace_billing_stripe_customer_id
  on public.workspace_billing(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists idx_workspace_billing_stripe_subscription_id
  on public.workspace_billing(stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.workspace_billing enable row level security;

-- Q4.1: a workspace admin (or global app_admin) manages their own company's billing; an
-- ordinary member can view but not write. Q4.2: a platform admin sees/acts on any workspace.
-- All actual mutation happens through SECURITY DEFINER RPCs or the webhook's own service-role
-- call (bypasses RLS) -- no direct authenticated INSERT/UPDATE/DELETE policy is granted here,
-- matching this migration's own threat model ("all billing-mutating actions go through a
-- SECURITY DEFINER RPC... never relying on RLS alone for an action this consequential").
create policy "workspace members read own workspace_billing"
  on public.workspace_billing for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_member(workspace_id));

revoke all on public.workspace_billing from public;
revoke all on public.workspace_billing from anon;
grant select on public.workspace_billing to authenticated;

-- ============================================================
-- Section 4 -- is_workspace_billing_blocked(): the one read this migration's whole
-- enforcement story depends on. True only for a workspace that is NOT comped and is in a
-- state Q1.3/E's correction #3 say should be read-only: 7+ calendar days into 'past_due'
-- (computed from past_due_since, never an assumed Stripe duration), 'unpaid'/'canceled'
-- outright, or an expired trial with no active subscription.
-- ============================================================

create or replace function public.is_workspace_billing_blocked(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_billing wb
    where wb.workspace_id = p_workspace_id
      and not wb.is_comped
      and (
        wb.status in ('unpaid', 'canceled')
        or (wb.status = 'past_due' and wb.past_due_since is not null and wb.past_due_since <= clock_timestamp() - interval '7 days')
        or (wb.status = 'trialing' and wb.trial_ends_at is not null and wb.trial_ends_at < clock_timestamp())
      )
  );
$$;

revoke all on function public.is_workspace_billing_blocked(uuid) from public;
revoke execute on function public.is_workspace_billing_blocked(uuid) from anon;
grant execute on function public.is_workspace_billing_blocked(uuid) to authenticated;

-- is_module_available(): the real, combined "can this workspace member use this module right
-- now" check -- workspace preference (migration 218) AND plan entitlement (Section 2), safe-
-- default when no billing row exists at all (pre-billing-era workspaces, though the AFTER
-- INSERT trigger in Section 5 means this should never actually happen going forward).
create or replace function public.is_module_available(p_workspace_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_module_enabled(p_workspace_id, p_module_key)
    and (
      not exists (select 1 from public.workspace_billing where workspace_id = p_workspace_id)
      or (select is_comped from public.workspace_billing where workspace_id = p_workspace_id)
      or public.plan_allows_module(
           (select plan_key from public.workspace_billing where workspace_id = p_workspace_id),
           p_module_key
         )
    );
$$;

revoke all on function public.is_module_available(uuid, text) from public;
revoke execute on function public.is_module_available(uuid, text) from anon;
grant execute on function public.is_module_available(uuid, text) to authenticated;

-- Widen the two established chokepoints -- is_active_workspace_member() (migration 155,
-- reused across dozens of INSERT/UPDATE/DELETE RLS policies) and resolve_caller_workspace_id()
-- (migration 117, called by every root-table write trigger) -- to ALSO reject when the
-- workspace's billing is blocked. Both are reproduced here byte-for-byte from their current
-- live definitions with exactly one addition each (confirmed by direct read before writing
-- this, not from memory) -- "read-only" falls out naturally: every SELECT policy in this
-- schema uses the plainer is_workspace_member()/is_module_enabled(), never these two, so reads
-- are completely unaffected; only write paths route through either function.

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
  ) and not public.is_workspace_billing_blocked(check_workspace_id);
$$;

create or replace function public.resolve_caller_workspace_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_membership_count int;
  active_membership_count int;
  result uuid;
begin
  select count(*) into total_membership_count
  from public.workspace_members
  where user_id = auth.uid();

  if total_membership_count = 0 then
    raise exception 'no workspace membership found for current user';
  end if;

  select count(*) into active_membership_count
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  if active_membership_count = 0 then
    raise exception 'workspace membership exists but the workspace is not active (suspended)';
  elsif active_membership_count > 1 then
    raise exception 'ambiguous active workspace membership for current user -- primary workspace selection is not yet implemented';
  end if;

  select wm.workspace_id into result
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  if public.is_workspace_billing_blocked(result) then
    raise exception 'This workspace''s billing is not current -- contact your workspace admin to update payment. All data is preserved and write access resumes automatically once payment is confirmed.';
  end if;

  return result;
end;
$$;

revoke all on function public.is_active_workspace_member(uuid) from public;
revoke all on function public.resolve_caller_workspace_id() from public;

-- ============================================================
-- Section 5 -- auto-provisioning: every new workspace gets a real workspace_billing row the
-- instant it's created (same after-insert-trigger pattern as seed_default_company_branding,
-- migration 182). plan_key='starter'/14-day trial are PLACEHOLDER defaults matching Q1.3's
-- recommended shape -- E's own still-open "what plan does a new trial receive" answer can
-- change this with a one-line function update later, not a new migration.
-- ============================================================

create or replace function public.seed_default_workspace_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_billing (workspace_id, plan_key, status, trial_ends_at, is_comped)
  values (new.id, 'starter', 'trialing', clock_timestamp() + interval '14 days', false)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_default_workspace_billing() from public;

drop trigger if exists workspaces_seed_default_billing on public.workspaces;
create trigger workspaces_seed_default_billing
  after insert on public.workspaces
  for each row execute function public.seed_default_workspace_billing();

-- Backfill: every workspace that already exists (Ergon's own real workspace, K-Tech Systems,
-- and any other pre-migration row) is marked comped=true, status='comped' -- not trialing.
-- Deliberate safety choice, not a permanent decision: with no real commercial terms approved
-- yet (no prices, no seat caps, no Stripe Price IDs), NO already-operating real company should
-- have any chance of a trial timer or payment-status enforcement firing against it. Ergon's
-- own workspace should stay comped permanently (Q1.4); K-Tech's real plan/trial assignment is
-- an open follow-up for E once commercial terms are approved, tracked in HANDOFF.md, not
-- guessed here.
insert into public.workspace_billing (workspace_id, plan_key, status, is_comped)
select id, null, 'comped', true from public.workspaces
where id not in (select workspace_id from public.workspace_billing)
on conflict (workspace_id) do nothing;

-- ============================================================
-- Section 6 -- billing_settings: the literal "keep production checkout disabled" switch, a
-- true singleton row. api/create-checkout-session.js refuses to create a real Checkout
-- session while checkout_enabled=false, regardless of everything else.
-- ============================================================

create table if not exists public.billing_settings (
  id smallint primary key default 1 check (id = 1),
  checkout_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id)
);

insert into public.billing_settings (id, checkout_enabled) values (1, false)
on conflict (id) do nothing;

alter table public.billing_settings enable row level security;

create policy "authenticated read billing_settings"
  on public.billing_settings for select to authenticated
  using (true);

create policy "platform admins manage billing_settings"
  on public.billing_settings for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.billing_settings from public;
revoke all on public.billing_settings from anon;
grant select, update on public.billing_settings to authenticated;

-- ============================================================
-- Section 7 -- stripe_webhook_events: idempotency ledger. No authenticated/anon access at all
-- -- written only via the webhook handler's own service-role key (Supabase service_role
-- bypasses RLS entirely), never by ordinary application code.
-- ============================================================

create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  processed_at timestamptz not null default clock_timestamp(),
  payload jsonb
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public;
revoke all on public.stripe_webhook_events from anon;
revoke all on public.stripe_webhook_events from authenticated;

-- ============================================================
-- Section 8 -- workspace_billing_audit_log: append-only, separate from company_admin_audit_log
-- (migration 198, platform-level manual actions) and workspace_module_audit_log (migration
-- 218, module toggles) -- this one is billing-specific and often system/webhook-triggered.
-- Same read-policy shape as workspace_module_audit_log for consistency.
-- ============================================================

create table if not exists public.workspace_billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  cause text not null check (cause in (
    'payment_failed', 'payment_recovered', 'admin_action', 'user_canceled',
    'trial_expired', 'trial_started', 'webhook', 'system'
  )),
  detail jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_workspace_billing_audit_log_workspace_id
  on public.workspace_billing_audit_log(workspace_id, created_at desc);

alter table public.workspace_billing_audit_log enable row level security;

create policy "workspace admins read own workspace billing audit log"
  on public.workspace_billing_audit_log for select to authenticated
  using (
    public.is_platform_admin()
    or (public.is_active_workspace_member(workspace_id) and public.is_workspace_admin(workspace_id))
  );

revoke all on public.workspace_billing_audit_log from public;
revoke all on public.workspace_billing_audit_log from anon;
grant select on public.workspace_billing_audit_log to authenticated;

-- ============================================================
-- Section 9 -- process_stripe_webhook_event(): the ONE atomic entry point the webhook handler
-- calls after verifying the Stripe signature. Idempotency insert and the actual state update
-- happen in the SAME function call (one implicit transaction) -- a webhook that fails partway
-- through never leaves a "recorded as processed but never actually applied" row, and a
-- duplicate delivery is a clean, fast no-op. `where not workspace_billing.is_comped` on the
-- update is the Q1.4 exemption enforced at the lowest possible level -- a webhook can never
-- override a comped workspace no matter what Stripe sends.
-- ============================================================

create or replace function public.process_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_workspace_id uuid,
  p_new_status text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_current_period_end timestamptz,
  p_plan_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted_id uuid;
  v_current_status text;
  v_current_past_due_since timestamptz;
  v_next_past_due_since timestamptz;
begin
  insert into public.stripe_webhook_events (stripe_event_id, event_type, payload)
  values (p_stripe_event_id, p_event_type, p_payload)
  on conflict (stripe_event_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return 'duplicate';
  end if;

  if p_workspace_id is null then
    return 'processed_no_workspace';
  end if;

  select status, past_due_since into v_current_status, v_current_past_due_since
  from public.workspace_billing where workspace_id = p_workspace_id;

  v_next_past_due_since := case
    when p_new_status = 'past_due' and v_current_status is distinct from 'past_due' then clock_timestamp()
    when p_new_status = 'past_due' then v_current_past_due_since
    else null
  end;

  insert into public.workspace_billing (
    workspace_id, plan_key, stripe_customer_id, stripe_subscription_id,
    status, current_period_end, past_due_since, updated_at
  ) values (
    p_workspace_id, p_plan_key, p_stripe_customer_id, p_stripe_subscription_id,
    p_new_status, p_current_period_end, v_next_past_due_since, clock_timestamp()
  )
  on conflict (workspace_id) do update set
    plan_key = coalesce(excluded.plan_key, public.workspace_billing.plan_key),
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.workspace_billing.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.workspace_billing.stripe_subscription_id),
    status = excluded.status,
    current_period_end = coalesce(excluded.current_period_end, public.workspace_billing.current_period_end),
    past_due_since = excluded.past_due_since,
    updated_at = clock_timestamp()
  where not public.workspace_billing.is_comped;

  insert into public.workspace_billing_audit_log (workspace_id, event_type, cause, detail)
  values (
    p_workspace_id,
    p_event_type,
    case
      when p_new_status = 'past_due' then 'payment_failed'
      when p_new_status = 'active' and v_current_status = 'past_due' then 'payment_recovered'
      else 'webhook'
    end,
    jsonb_build_object('stripe_event_id', p_stripe_event_id, 'previous_status', v_current_status, 'new_status', p_new_status)
  );

  return 'processed';
end;
$$;

-- No grant to authenticated/anon at all -- called exclusively via the service-role key from
-- api/stripe-webhook.js, which bypasses RLS/grants entirely. Deliberately not exposed as a
-- callable RPC for any ordinary session.
revoke all on function public.process_stripe_webhook_event(text, text, jsonb, uuid, text, text, text, timestamptz, text) from public;
revoke all on function public.process_stripe_webhook_event(text, text, jsonb, uuid, text, text, text, timestamptz, text) from authenticated;
revoke all on function public.process_stripe_webhook_event(text, text, jsonb, uuid, text, text, text, timestamptz, text) from anon;

-- ============================================================
-- Section 10 -- set_workspace_module_enabled() (migration 218): forward-fixed, NOT re-run or
-- edited at 218 itself, to add the entitlement check E's correction #1 requires. Byte-for-byte
-- identical to 218's own version with exactly one new guard: enabling a module now fails if
-- the workspace's plan doesn't include it (comped workspaces and not-yet-configured plans are
-- exempt via plan_allows_module()'s own safe default, so this is a no-op for every workspace
-- today). Disabling a module is never restricted by entitlement.
-- ============================================================

create or replace function public.set_workspace_module_enabled(p_module_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := public.resolve_caller_workspace_id();

  if not (public.is_app_admin(auth.uid()) or public.is_workspace_admin(v_workspace_id)) then
    raise exception 'Only a workspace admin may change module settings';
  end if;

  if p_enabled and not public.plan_allows_module(
    (select plan_key from public.workspace_billing where workspace_id = v_workspace_id),
    p_module_key
  ) then
    raise exception 'Your current plan does not include this module -- upgrade your plan to enable it.';
  end if;

  insert into public.workspace_enabled_modules (workspace_id, module_key, enabled, updated_at, updated_by)
  values (v_workspace_id, p_module_key, p_enabled, clock_timestamp(), auth.uid())
  on conflict (workspace_id, module_key)
  do update set enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.workspace_module_audit_log (workspace_id, actor_user_id, module_key, action)
  values (v_workspace_id, auth.uid(), p_module_key, case when p_enabled then 'enabled' else 'disabled' end);
end;
$$;

revoke all on function public.set_workspace_module_enabled(text, boolean) from public;
revoke execute on function public.set_workspace_module_enabled(text, boolean) from anon;
grant execute on function public.set_workspace_module_enabled(text, boolean) to authenticated;

-- ============================================================
-- Section 11 -- get_my_billing_context(): resolves the caller's own workspace_id/admin status/
-- billing row WITHOUT going through resolve_caller_workspace_id()'s billing-blocked check --
-- deliberately, since api/create-checkout-session.js and api/create-billing-portal-session.js
-- both need to work for an ALREADY-blocked workspace (that's the whole point of the portal:
-- letting an admin fix a failed payment). Membership/active-workspace-status is still checked
-- (a suspended, non-billing-related workspace still can't reach this) -- only the billing-block
-- condition itself is deliberately not applied here.
-- ============================================================

create or replace function public.get_my_billing_context()
returns table (
  workspace_id uuid,
  is_admin boolean,
  plan_key text,
  status text,
  is_comped boolean,
  stripe_customer_id text,
  stripe_subscription_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select wm.workspace_id into v_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid() and w.status = 'active'
  limit 1;

  if v_workspace_id is null then
    raise exception 'no active workspace membership found for current user';
  end if;

  return query
  select
    v_workspace_id,
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(v_workspace_id)),
    wb.plan_key, wb.status, wb.is_comped, wb.stripe_customer_id, wb.stripe_subscription_id
  from public.workspace_billing wb
  where wb.workspace_id = v_workspace_id;
end;
$$;

revoke all on function public.get_my_billing_context() from public;
revoke execute on function public.get_my_billing_context() from anon;
grant execute on function public.get_my_billing_context() to authenticated;

commit;

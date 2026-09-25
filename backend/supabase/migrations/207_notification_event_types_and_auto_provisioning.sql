-- Migration 207: notification_event_types lookup table + a shared
-- provision_default_notification_rules() function -- closes a real,
-- confirmed gap: a brand-new workspace created via the self-serve signup
-- flow (migrations 195/196, approve_company_signup()) gets ZERO
-- notification_rules rows. The Admin "Notification Rules" panel
-- (src/main.tsx) only ever renders rows that already exist -- there is no
-- "add a rule" affordance anywhere in it -- so a new company's panel is
-- permanently empty, with no way for anyone to ever turn on any
-- notification, for any event type, without a developer manually
-- inserting a database row.
--
-- Migration 195's own header already documented this as a deliberate
-- choice at the time ("Deliberately NOT seeded, per E's own 2026-09-22
-- decision... notification_rules... a workspace with zero rows in any of
-- them is a correct, honest 'not configured yet' state... Flagged as a
-- real, known gap for a future pass, not silently skipped"), and
-- migration 173's own header (point 4) flagged the identical thing,
-- pending "Stage 7's own reviewed provisioning procedure." This migration
-- is that procedure.
--
-- E's exact decision, verbatim, not re-litigated here: "Choose Option 2:
-- Auto-seed every event type on workspace creation. A new company should
-- work immediately without knowing it must manually build notification
-- rules. Seed sensible defaults, then let its admin customize channels
-- and enable/disable rules in the existing panel. Also require the
-- implementation to: Use one shared provisioning function for existing
-- and future workspaces. Backfill missing rules without overwriting
-- existing settings. Add tests proving every valid event type is
-- provisioned. Automatically include future event types so this gap does
-- not recur. An 'Add rule' picker can be added later, but it should not
-- be required for basic notifications to function."
--
-- ============================================================
-- Step 1 -- the complete, currently-true event_type list, confirmed
-- directly from source, not from memory
-- ============================================================
-- notification_rules.event_type's CHECK constraint has been widened many
-- times since migration 024's original 7-value list. Migration 173's own
-- header already confirmed the live count directly (pg_get_constraintdef
-- cross-checked against a live row dump): 14 values as of migrations
-- 046/049/054/095/108/110/149. Migration 200 then added a 15th
-- (support_case_assigned) and migration 201 a 16th
-- (product_request_reviewed) -- confirmed directly from 201's own final
-- `alter table ... add constraint notification_rules_event_type_check
-- check (event_type in (...))` statement, the LAST migration on disk to
-- touch this constraint (203-206 do not reference notification_rules at
-- all). The real, current, live list is exactly these 16 values:
--
--   build_stage_changed, catalog_price_change_requested,
--   catalog_price_change_reviewed, direct_message_received,
--   low_stock_reached, mentioned, purchase_request_status_changed,
--   quote_proposal_responded, submittal_responded, task_assigned,
--   task_overdue, task_status_changed, user_signup_pending,
--   proposal_question_received, support_case_assigned,
--   product_request_reviewed
--
-- Cross-checked against api/_lib/notificationEvents.js's real HANDLERS
-- object (the events the generic notification dispatcher actually
-- fires): support_case_assigned, product_request_reviewed, task_assigned,
-- task_status_changed, purchase_request_status_changed,
-- build_stage_changed, low_stock_reached, catalog_price_change_requested,
-- catalog_price_change_reviewed, user_signup_pending, mentioned -- 11 of
-- the 16, all present with zero mismatches. The other 5 (task_overdue,
-- direct_message_received, quote_proposal_responded,
-- submittal_responded, proposal_question_received) are real, live events
-- fired through OTHER, already-secured code paths rather than this one
-- generic dispatcher -- confirmed by name, not assumed: task_overdue by
-- api/cron/task-overdue.js (a scheduled job, never client-triggered
-- through HANDLERS); direct_message_received by create-notification.js's
-- own dedicated `directMessageId` mode (api/create-notification.js:24,
-- 92 -- deliberately excluded from SUPPORTED_EVENT_TYPES/HANDLERS since
-- it needs its own resolution logic); quote_proposal_responded /
-- submittal_responded / proposal_question_received by their own
-- dedicated, already-reviewed RPCs (migrations 119/121/122/149's
-- respond_to_quote_proposal / secure_submittal_response / proposal
-- question functions), which insert into `notifications` directly. None
-- of the 16 is dead or unused; all 16 are seeded below.
--
-- ============================================================
-- Step 2 -- future event types: a lookup table with a real FK, not
-- another CHECK-widening migration -- here is why
-- ============================================================
-- The CHECK-constraint-widening pattern is exactly what caused this bug
-- twice already, in this same migration history: migrations 200 and 201
-- each correctly widened the CHECK constraint to legalize a new
-- event_type value, and each forgot the equally necessary "seed a default
-- row" step -- only caught afterward by migration 202's own manual
-- forensic pass. A hardcoded event-type list baked into a new seeding
-- function would just relocate that same two-separate-places-to-remember
-- trap, not close it, the moment a 17th event type is ever added.
--
-- Fix chosen: DECISION -- (a), FK replacing CHECK, not kept alongside it.
-- A new reference table, notification_event_types, holds the
-- authoritative list of valid event types AND each one's sensible default
-- channels/is_active (Step 3). notification_rules.event_type's old CHECK
-- constraint is DROPPED and REPLACED with a real foreign key to this
-- table's primary key -- not kept redundantly alongside it. Reasoning for
-- dropping rather than keeping both: keeping both would mean every future
-- event type still has to be added in two separate places (the CHECK
-- list AND the lookup table) -- the identical redundant-bookkeeping trap
-- that already bit 200/201 once the CHECK-widening habit was established.
-- A single source of truth means there is exactly one place left to
-- update, ever again: insert a row into notification_event_types. This is
-- LOW risk to apply immediately, not a cautious "maybe later" change:
-- every value notification_rules.event_type could possibly already hold
-- is, by construction, a member of the very same 16-value list the old
-- CHECK constraint enforced, and all 16 are seeded into
-- notification_event_types BEFORE the FK is created below -- the FK
-- validates instantly against real data with zero possibility of
-- violation, no NOT VALID/VALIDATE CONSTRAINT two-step needed.
-- Established as this schema's new standing convention going forward,
-- stated explicitly: any FUTURE migration that adds a new notification
-- event type inserts ONE row into notification_event_types (and, if
-- existing workspaces should get it retroactively, loops
-- provision_default_notification_rules() over them, exactly like this
-- migration's own one-time backfill below) -- it never touches a CHECK
-- constraint on notification_rules again, because there isn't one left.
--
-- ============================================================
-- Step 3 -- the shared provisioning function, and its workspace_id guard
-- ============================================================
-- provision_default_notification_rules(p_workspace_id) is SECURITY
-- DEFINER and idempotent (`on conflict (workspace_id, event_type) do
-- nothing`, against the existing notification_rules_workspace_id_event_
-- type_key unique constraint from migration 173) -- calling it against a
-- workspace that already has some rows with customized channels/is_active
-- only fills in genuinely missing event types, never touching an existing
-- row's values (E's own explicit "backfill missing rules without
-- overwriting existing settings" requirement).
--
-- notification_rules' existing workspace_id guard trigger
-- (notification_rules_guard_workspace_id, reusing the generic, shared
-- guard_workspace_id_mutation() since migration 173) unconditionally
-- overwrites new.workspace_id with resolve_caller_workspace_id() on
-- INSERT -- exactly the same obstacle migration 202's own header already
-- hit and worked around (by disabling the trigger for its one-time manual
-- backfill), and exactly the same obstacle migration 195's
-- guard_channel_workspace_id_mutation() redefinition solved permanently
-- for channels via a transaction-local escape-hatch GUC
-- (app.provisioning_workspace_id, set via set_config(..., true) --
-- local-scoped, auto-reverts at end of transaction). This migration reuses
-- that exact same, already-reviewed GUC name and pattern for
-- notification_rules, but as its OWN dedicated trigger function
-- (guard_notification_rules_workspace_id_mutation()) rather than editing
-- the generic guard_workspace_id_mutation() that clients/sales_quotes/
-- standard_install_times/project_schedule_templates still rely on,
-- unmodified. Confirmed directly from src/persistence.ts
-- (loadNotificationRules is a plain SELECT, updateNotificationRule is a
-- plain PATCH by id -- lines ~4865-4905) that the frontend has NO insert
-- path onto notification_rules at all today, so redirecting this table's
-- INSERT guard through the escape hatch changes behavior for zero
-- existing real user-facing write paths -- only for provisioning.
-- provision_default_notification_rules() sets and clears this GUC around
-- its own insert, so it works identically whether called from an
-- authenticated admin's session (approve_company_signup) or a bare
-- migration-time backfill loop with no auth.uid() session at all (this
-- migration's own one-time pass over every existing workspace, below).
--
-- provision_default_notification_rules() is deliberately granted to
-- NEITHER anon NOR authenticated (same posture as
-- submit_company_signup_request, migration 195) -- it fully bypasses the
-- normal is_app_admin()/is_app_manager()-gated write policy via the GUC
-- escape hatch, so exposing it directly would let any signed-in user
-- force-seed rows into an arbitrary workspace_id of their own choosing.
-- It is reachable only from other SECURITY DEFINER functions that call it
-- internally (no grant needed for that -- same reasoning already
-- documented in migration 117's header for guard_workspace_id_mutation()
-- calling resolve_caller_workspace_id()) and from this migration's own
-- one-time backfill. A future "provision my own workspace's missing
-- rules" admin action, or the "Add rule" picker E's decision explicitly
-- defers, gets its OWN thin wrapper function with its own
-- is_app_admin()/is_workspace_admin() gate -- not a grant on this one.
--
-- approve_company_signup() (migrations 195/196) is redefined here to call
-- provision_default_notification_rules(v_workspace_id) immediately after
-- seeding the 4 default section channels -- same position, same pattern.
-- Every other line is reproduced verbatim from migration 196's current,
-- live version (is_platform_admin() gate, 'pending' workspace status,
-- 7-day token expiration) -- nothing else changed.
--
-- Finally, this migration also runs provision_default_notification_rules
-- ONCE, directly, for every EXISTING workspace. Safe to run even though
-- migration 202 already manually seeded 2 rows (support_case_assigned,
-- product_request_reviewed) for the one real pre-migration-173 production
-- workspace: this call finds those 2 already exist and skips them via ON
-- CONFLICT DO NOTHING, while correctly seeding any other event type that
-- workspace might still be missing, and correctly seeds all 16 for
-- "ZZ Test Signup Co" and any other workspace created since.

begin;

-- ============================================================
-- notification_event_types -- the new single source of truth for "what
-- event types exist" and "what's a sensible default row for one."
-- default_channels/default_is_active below are NOT an arbitrary uniform
-- choice -- each pair reproduces this schema's own historical per-event
-- default exactly, the literal channels/is_active values the migration
-- that introduced that event type originally seeded it with: 024 (the
-- original 7), 046, 049, 054, 095 (channel corrected by 110), 108, 149,
-- 200/201 (backfilled by 202).
-- ============================================================

create table if not exists public.notification_event_types (
  event_type text primary key,
  default_channels text[] not null default '{in_app}'::text[],
  default_is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.notification_event_types enable row level security;

create policy "authenticated read notification_event_types"
  on public.notification_event_types for select to authenticated using (true);

-- No insert/update/delete policy for any role -- this table is
-- maintained exclusively through migrations (this one, and any future
-- migration that adds a notification event type per Step 2's new
-- standing convention above), never through the API or a client role.
-- Matches company_signup_requests' own "no INSERT policy at all" posture
-- (migration 195).
revoke all on public.notification_event_types from anon;

insert into public.notification_event_types (event_type, default_channels, default_is_active) values
  ('task_assigned', '{in_app}', true),
  ('task_overdue', '{in_app}', true),
  ('task_status_changed', '{in_app}', false),
  ('purchase_request_status_changed', '{in_app}', false),
  ('build_stage_changed', '{in_app}', false),
  ('submittal_responded', '{in_app}', true),
  ('low_stock_reached', '{in_app}', false),
  ('catalog_price_change_requested', '{in_app}', true),
  ('catalog_price_change_reviewed', '{in_app}', true),
  ('user_signup_pending', '{in_app}', true),
  ('quote_proposal_responded', '{in_app}', true),
  ('direct_message_received', '{push}', true),
  ('mentioned', '{in_app,push}', true),
  ('proposal_question_received', '{in_app}', true),
  ('support_case_assigned', '{in_app}', true),
  ('product_request_reviewed', '{in_app}', true)
on conflict (event_type) do nothing;

do $$
declare
  seeded_count integer;
begin
  select count(*) into seeded_count from public.notification_event_types;
  if seeded_count <> 16 then
    raise exception 'notification_event_types has % rows after seeding, expected exactly 16 -- Step 1 list mismatch', seeded_count;
  end if;
end $$;

-- ============================================================
-- FK replacing CHECK -- see Step 2 above for the full reasoning. Safe to
-- apply unconditionally: every notification_rules.event_type value that
-- can possibly exist already satisfies this exact same 16-value list (it
-- was the old CHECK constraint's own list), all 16 of which are seeded
-- immediately above, so this validates instantly against real data.
-- ============================================================

alter table public.notification_rules drop constraint if exists notification_rules_event_type_check;

alter table public.notification_rules
  add constraint notification_rules_event_type_fkey
  foreign key (event_type) references public.notification_event_types(event_type);

-- ============================================================
-- Dedicated workspace_id guard trigger for notification_rules, carrying
-- the same transaction-local escape hatch migration 195 already
-- established for channels (app.provisioning_workspace_id). See this
-- file's header (Step 3) for why this is a NEW dedicated trigger function
-- rather than an edit to the shared guard_workspace_id_mutation().
-- ============================================================

create or replace function public.guard_notification_rules_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provisioning_workspace_id text;
begin
  if TG_OP = 'INSERT' then
    v_provisioning_workspace_id := nullif(current_setting('app.provisioning_workspace_id', true), '');
    if v_provisioning_workspace_id is not null and v_provisioning_workspace_id = new.workspace_id::text then
      return new;
    end if;
    new.workspace_id := public.resolve_caller_workspace_id();
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_notification_rules_workspace_id_mutation() from public;

drop trigger if exists notification_rules_guard_workspace_id on public.notification_rules;
create trigger notification_rules_guard_workspace_id
  before insert or update on public.notification_rules
  for each row execute function public.guard_notification_rules_workspace_id_mutation();

-- ============================================================
-- provision_default_notification_rules -- the shared function. See this
-- file's header (Step 3) for the full grant/security rationale: no grant
-- to anon or authenticated, reachable only from other SECURITY DEFINER
-- functions and from this migration's own backfill below.
-- ============================================================

create or replace function public.provision_default_notification_rules(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.provisioning_workspace_id', p_workspace_id::text, true);

  insert into public.notification_rules (workspace_id, event_type, channels, is_active)
  select p_workspace_id, event_type, default_channels, default_is_active
  from public.notification_event_types
  on conflict (workspace_id, event_type) do nothing;

  perform set_config('app.provisioning_workspace_id', '', true);
end;
$$;

revoke all on function public.provision_default_notification_rules(uuid) from public;
revoke execute on function public.provision_default_notification_rules(uuid) from anon;
revoke execute on function public.provision_default_notification_rules(uuid) from authenticated;

-- ============================================================
-- approve_company_signup -- redefined, adding exactly one new call
-- (perform public.provision_default_notification_rules(v_workspace_id))
-- right after the existing section-channel seed. Every other line is
-- reproduced verbatim from migration 196's current, live version.
-- ============================================================

create or replace function public.approve_company_signup(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_signup_requests;
  v_workspace_id uuid;
  v_slug text;
  v_base_slug text;
  v_suffix int := 1;
  v_token uuid := gen_random_uuid();
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may approve a company signup request';
  end if;

  select * into v_request from public.company_signup_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Signup request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Signup request has already been % -- cannot approve again', v_request.status;
  end if;

  v_base_slug := lower(regexp_replace(regexp_replace(v_request.company_name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));
  if char_length(v_base_slug) = 0 then
    v_base_slug := 'company';
  end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.workspaces where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  -- 'pending', not 'active' -- accept_company_signup activates it
  -- (migration 196, item 6).
  insert into public.workspaces (name, slug, status)
  values (v_request.company_name, v_slug, 'pending')
  returning id into v_workspace_id;

  update public.company_branding set company_name = v_request.company_name where workspace_id = v_workspace_id;

  perform set_config('app.provisioning_workspace_id', v_workspace_id::text, true);

  insert into public.channels (type, section_key, name, workspace_id)
  values
    ('section', 'inventory', 'Inventory & Purchasing', v_workspace_id),
    ('section', 'projects', 'Projects', v_workspace_id),
    ('section', 'sales', 'Sales', v_workspace_id),
    ('section', 'marketing', 'Marketing', v_workspace_id)
  on conflict (type, section_key, workspace_id) do nothing;

  perform set_config('app.provisioning_workspace_id', '', true);

  -- New (migration 207): every currently-valid notification event type
  -- gets a sensible default row for this brand-new workspace, so its
  -- Admin -> Notification Rules panel is never permanently empty. Uses
  -- the SAME app.provisioning_workspace_id escape hatch internally (set
  -- and cleared by provision_default_notification_rules() itself), so
  -- this is safe to call after the channels GUC above has already been
  -- reset to ''.
  perform public.provision_default_notification_rules(v_workspace_id);

  update public.company_signup_requests
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      created_workspace_id = v_workspace_id,
      signup_token = v_token,
      signup_token_expires_at = now() + interval '7 days',
      signup_token_revoked_at = null
  where id = p_request_id;

  return jsonb_build_object('workspace_id', v_workspace_id, 'signup_token', v_token);
end;
$$;

revoke all on function public.approve_company_signup(uuid) from public;
revoke execute on function public.approve_company_signup(uuid) from anon;
grant execute on function public.approve_company_signup(uuid) to authenticated;

-- ============================================================
-- One-time backfill: provision every EXISTING workspace. Idempotent --
-- safe alongside migration 202's own manual 2-row seed (ON CONFLICT DO
-- NOTHING skips those, fills in everything else missing for that
-- workspace and all 16 for every other workspace).
-- ============================================================

do $$
declare
  ws record;
begin
  for ws in select id from public.workspaces loop
    perform public.provision_default_notification_rules(ws.id);
  end loop;
end $$;

commit;

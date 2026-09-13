-- Queue C2.2 (2026-09-13): Share-link lifecycle foundation -- INERT schema
-- only. Adds the decided token states/metadata, workspace expiration
-- defaults, and view/action audit tables. Deliberately changes NOTHING
-- about token resolution or any client-visible behavior: every public
-- lookup/response RPC (get_quote_proposal_by_token, respond_to_quote_proposal,
-- get_submittal_by_token, respond_to_submittal) is untouched by this file --
-- a link that resolves today resolves identically after this migration
-- runs, because nothing yet reads the new `status` column or writes these
-- new tables. That comes in Queue C2.3/C2.4, as separate, later migrations,
-- once E has reviewed and approved this schema on its own.
--
-- Full design: PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md Part 9
-- (Parts 8/9.1 items 5-8 specifically -- items 1-4/9-11, the Billing/
-- capability/PM-handoff work, are explicitly out of scope for this queue,
-- per CONTINUOUS_CODER_HANDOFF.md's own Queue C2 boundary). Dependency
-- order: PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md's reconciled 11-step
-- list, steps 1 (this file) through roughly 3.
--
-- Confirm 137 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review, same as every other migration in
-- this repository.

begin;

-- ============================================================
-- 1. Link lifecycle state on public_share_tokens (Part 9.1 item 5).
--    `add column ... not null default 'active'` backfills every existing
--    row to 'active' as part of the ALTER itself -- no separate UPDATE
--    needed, and no existing token's real-world behavior changes (every
--    current lookup RPC still only checks expires_at, unchanged by this
--    migration).
-- ============================================================

alter table public.public_share_tokens
  add column if not exists status text not null default 'active'
    check (status in ('active', 'temporarily_disabled', 'permanently_revoked', 'superseded')),
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references auth.users(id),
  add column if not exists disabled_reason text,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id),
  add column if not exists revoked_reason text,
  -- Self-reference: the NEW token that superseded this row, set only when
  -- a regenerate/supersede action creates a fresh token for the same
  -- document. Nullable -- most tokens are never superseded.
  add column if not exists superseded_by_token text references public.public_share_tokens(token);

create index if not exists idx_public_share_tokens_entity on public.public_share_tokens(entity_type, entity_id);
create index if not exists idx_public_share_tokens_status on public.public_share_tokens(status);

-- No RLS policy change here -- public_share_tokens keeps its existing
-- "authenticated manage" policy (migration 025) exactly as-is. Narrowing
-- direct writes on this table is Queue C2.7's job, done only after the
-- sanctioned lifecycle RPCs (C2.3/C2.4) exist to replace them -- adding
-- these columns first, then closing direct writes, is the only safe
-- order (closing writes before the RPCs exist would break link creation
-- entirely).

-- ============================================================
-- 2. Workspace-scoped expiration defaults (Part 9.1 items 6/7). One row
--    per workspace, keyed to workspaces.id (the immutable identifier,
--    never slug/name -- both have already changed once, migration 116).
--    Mirrors company_branding's (migration 039) own admin-write/
--    authenticated-read pattern for a workspace-level configuration
--    table -- same precedent, not a new access model.
--
--    default_expiration_open_documents: 30 days. This specific number was
--    never separately recorded as a final decision the way the
--    completed-document default was (Part 8 item 5, "initially 2 years")
--    -- it only ever appeared as an illustrative example in the decision
--    document's own comparison/interface-description sections. 30 days is
--    used here as a reasonable starting value, matching that same
--    illustrative example, NOT presented as a locked business decision --
--    the whole point of this being a workspace-configurable settings row
--    (not a hardcoded constant) is that E can change it later with no
--    migration required, once the Settings -> Document Links screen
--    (Part 9.3) exists. Flagged in the decision register as still open in
--    the specific-number sense, even though the mechanism is fully
--    decided.
-- ============================================================

create table if not exists public.workspace_share_link_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  default_expiration_open_documents interval not null default '30 days',
  default_expiration_completed_documents interval not null default '2 years',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.workspace_share_link_settings enable row level security;

create policy "authenticated read workspace_share_link_settings"
  on public.workspace_share_link_settings for select to authenticated using (true);

create policy "admin write workspace_share_link_settings"
  on public.workspace_share_link_settings for all to authenticated
  using (public.is_app_admin(auth.uid()))
  with check (public.is_app_admin(auth.uid()));

-- Seed exactly one row, for today's one real active workspace -- mirrors
-- migration 117's own "backfill to the one real workspace" precedent, not
-- a new workspace and not demo data. If no active workspace exists yet
-- (a genuinely empty environment), this seed is silently skipped rather
-- than failing the whole migration -- the settings row is created lazily
-- the first time it's actually needed (C2.3's token-creation RPC), same
-- defensive posture as this schema's other nullable-until-needed fields.
insert into public.workspace_share_link_settings (workspace_id)
select id from public.workspaces where status = 'active'
on conflict (workspace_id) do nothing;

-- ============================================================
-- 3. Audit log storage (Part 9.1 item 8) -- two tables, link views and
--    employee actions, exactly as decided. Neither table is written by
--    anything yet (that's C2.3/C2.4's job, via security-definer RPCs
--    that bypass RLS for their own writes) -- RLS here only grants
--    read access, matching this app's established "no single role owns
--    this workflow yet" wide-open-SELECT posture (Queue C2.7 explicitly
--    keeps SELECT-narrowing decisions out of this whole queue).
-- ============================================================

create table if not exists public.share_link_views (
  id uuid primary key default gen_random_uuid(),
  -- Nullable, not a hard FK requirement for querying -- set null rather
  -- than cascading a delete, though no part of this design ever hard-
  -- deletes a token row (status transitions only).
  token text references public.public_share_tokens(token) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  viewed_at timestamptz not null default now(),
  -- The SPECIFIC internal result -- shown only to authorized internal
  -- users via the document's own history (Part 9.3), never surfaced to
  -- the client beyond the three decided customer-facing messages
  -- (superseded / expired / unavailable).
  result text not null check (result in ('success', 'invalid_token', 'expired', 'disabled', 'revoked', 'superseded')),
  -- Deliberately minimal, per the decided scope -- "only minimum
  -- necessary technical detail (no broad fingerprinting)". No IP, no
  -- user agent, no device fingerprint of any kind is stored by this
  -- schema; this column exists only for a short, safe note if one is
  -- ever genuinely needed (e.g. which specific lookup branch matched),
  -- never raw request data.
  safe_detail text
);

create index if not exists idx_share_link_views_entity on public.share_link_views(entity_type, entity_id, viewed_at desc);
create index if not exists idx_share_link_views_token on public.share_link_views(token);

alter table public.share_link_views enable row level security;

create policy "authenticated read share_link_views"
  on public.share_link_views for select to authenticated using (true);

create table if not exists public.share_link_actions (
  id uuid primary key default gen_random_uuid(),
  token text references public.public_share_tokens(token) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in (
    'created', 'sent', 'temporarily_disabled', 're_enabled', 'permanently_revoked',
    'regenerated', 'superseded', 'expiration_changed'
  )),
  actor_id uuid references auth.users(id),
  actor_email text,
  -- Nullable -- a mandatory, enforced-non-empty reason is a decided
  -- requirement only for the manager/admin OVERRIDE capability (Part
  -- 9.1 item 10, Part 9.3), which is explicitly Stage-2/capability-
  -- system territory and out of scope for this queue. An ordinary
  -- Sales-initiated disable/revoke/regenerate in THIS queue's scope
  -- carries no such requirement per the decided design -- enforcing one
  -- here would invent a rule that was never actually decided for the
  -- non-override case.
  reason text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_share_link_actions_entity on public.share_link_actions(entity_type, entity_id, occurred_at desc);
create index if not exists idx_share_link_actions_occurred_at on public.share_link_actions(occurred_at desc);

alter table public.share_link_actions enable row level security;

create policy "authenticated read share_link_actions"
  on public.share_link_actions for select to authenticated using (true);

-- ============================================================
-- Minimum grants note: no anon grant is added on either audit table or
-- workspace_share_link_settings -- none of the four public lookup/
-- response RPCs need to read or write them (view-logging is added to
-- those RPCs in C2.3/C2.4, at which point they call a security-definer
-- helper that bypasses RLS for its own insert, the same pattern already
-- established for record_system_health_event-style writers elsewhere in
-- this design). This migration only ever grants `authenticated` SELECT.
-- ============================================================

commit;

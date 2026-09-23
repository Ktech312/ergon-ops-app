-- Migration 198: platform-administration company lifecycle (Suspend /
-- Reactivate) + a durable audit log, closing out the "Ergon Platform"
-- console work E asked to continue directly after migration 197
-- ("is there an Ergon admin page for me to control these things...").
-- E's own numbered spec for this migration (2026-09-22), reproduced in
-- full so the reasoning below can be checked against it line by line:
--
--   1. Keep the entire console strictly gated by is_platform_admin() in
--      both the UI and database.
--   2. Prove that a company app_admin or workspace_admin who is not a
--      platform admin cannot see the console, signup queue, tokens, or
--      all-company list.
--   3. Move company signup review completely out of the individual
--      company Admin page.
--   4. Make company-list load failures visible. Never convert a failed
--      request into a misleading "No companies yet" state.
--   5. Support Suspend and Reactivate as the reversible
--      company-management actions.
--   6. Do not implement hard workspace deletion. Label "Remove company"
--      as future retention/deletion-policy work rather than claiming it
--      exists.
--   7. Suspending a company must block its members through the existing
--      active-workspace checks without deleting data, memberships,
--      files, or history.
--   8. Require an explicit confirmation and reason for
--      suspension/reactivation and record a durable audit event.
--   9. Prevent accidental suspension of the platform admin's currently
--      active company without an additional explicit warning.
--   10. Add tests for platform-admin access, ordinary company-admin
--       denial, load-error visibility, suspension, reactivation, and
--       audit logging.
--
-- Items 1-3 are already true of the live schema (migration 196's
-- is_platform_admin() gate on the console's tables/RPCs; the frontend
-- work that shipped alongside 197 already relocated
-- CompanySignupRequestsPanel out of the per-company AdminPage into the
-- new isPlatformAdmin-gated ErgonPlatformPage). Item 4 is frontend-only
-- (loadPlatformWorkspaces/ErgonPlatformPage, companion commit, not this
-- file) -- no schema change makes a fetch fail more or less visibly.
-- Item 6 is a deliberate non-action, documented here rather than in
-- code: no delete_company()/drop-workspace RPC is added by this
-- migration or planned by this one. This file is items 5, 7 (verified,
-- not built new), 8, and 9.
--
-- ============================================================
-- Item 7 -- already true by construction, verified rather than built.
-- resolve_caller_workspace_id() (migration 117:148-187, unchanged since,
-- still the tenancy resolver nearly every workspace-scoped RLS policy
-- and RPC in this schema calls) already requires the caller's workspace
-- membership to join to a workspaces row with status = 'active' --
-- "workspace membership exists but the workspace is not active
-- (suspended)" is its own literal, pre-existing exception text. Setting
-- workspaces.status = 'suspended' therefore already blocks every read
-- and write routed through that resolver, for every member, with zero
-- rows touched in workspace_members or any tenant table -- exactly
-- item 7's requirement, satisfied by the status flip alone. This
-- migration's canonical test proves this directly (Section (f)) rather
-- than assuming it.
-- ============================================================
--
-- ============================================================
-- Items 5, 8, 9 -- suspend_company() / reactivate_company(), both
-- platform-admin-gated, both requiring a non-empty reason, both writing
-- one row to the new company_admin_audit_log table in the same
-- transaction as the status flip (atomic by construction -- a plpgsql
-- function body is one implicit transaction). Item 9's "additional
-- explicit warning" is primarily a frontend double-confirmation step
-- (ErgonPlatformPage already knows the caller's own workspace id via
-- company_branding, loaded at top-level app state) -- but defense in
-- depth matters here specifically because this session already found
-- one real authorization bug that UI-only gating would not have caught
-- (the is_app_admin()/is_platform_admin() mixup). suspend_company() also
-- enforces the confirmation server-side: p_confirm_own_workspace
-- defaults to false, and suspending a workspace the caller is themselves
-- a member of without passing true raises a distinct, named exception
-- the frontend detects and turns into its own warning step, rather than
-- a generic failure toast.
-- ============================================================

begin;

-- ============================================================
-- Schema -- company_admin_audit_log. Deliberately separate from
-- company_signup_requests (a different lifecycle entirely) and from any
-- existing per-workspace activity log (this is platform-level, about a
-- workspace as a whole, not an in-workspace user action). No update or
-- delete policy exists for any role -- an audit log that can be edited
-- or removed by the same role it audits is not a durable record. Writes
-- happen exclusively through the two SECURITY DEFINER functions below;
-- reads are restricted to platform admins.
-- ============================================================

create table if not exists public.company_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('suspended', 'reactivated')),
  reason text not null check (char_length(btrim(reason)) > 0),
  -- clock_timestamp(), not now()/transaction_timestamp() -- an audit
  -- log's own timestamp must reflect the real moment each event was
  -- recorded, not freeze at whatever instant the surrounding transaction
  -- began. This only differs from now() when two audit events are
  -- written inside the same transaction (this migration's own canonical
  -- test does exactly that, inside one do $$ ... $$ block) -- every real
  -- suspend/reactivate call from PostgREST already runs in its own
  -- transaction, so this is strictly more correct with no change to any
  -- real, already-observed production behavior.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_company_admin_audit_log_workspace_id
  on public.company_admin_audit_log(workspace_id, created_at desc);

alter table public.company_admin_audit_log enable row level security;

drop policy if exists "platform admins read company_admin_audit_log" on public.company_admin_audit_log;
create policy "platform admins read company_admin_audit_log" on public.company_admin_audit_log for select to authenticated
  using (public.is_platform_admin());

revoke all on public.company_admin_audit_log from public;
revoke all on public.company_admin_audit_log from anon;

-- ============================================================
-- suspend_company -- items 5, 7 (verification), 8, 9.
-- ============================================================

create or replace function public.suspend_company(
  p_workspace_id uuid,
  p_reason text,
  p_confirm_own_workspace boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status text;
  v_caller_is_member boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may suspend a company';
  end if;

  if v_reason is null then
    raise exception 'A reason is required to suspend a company';
  end if;

  select status into v_status from public.workspaces where id = p_workspace_id for update;
  if v_status is null then
    raise exception 'Company not found';
  end if;
  if v_status <> 'active' then
    raise exception 'Company is not active (current status: %) -- nothing to suspend', v_status;
  end if;

  -- Item 9: the caller is a member of the very company they are about to
  -- suspend -- distinct, named failure so the frontend can render its own
  -- explicit warning step and resubmit with p_confirm_own_workspace = true,
  -- rather than a generic error.
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  ) into v_caller_is_member;

  if v_caller_is_member and not p_confirm_own_workspace then
    raise exception 'OWN_WORKSPACE_CONFIRMATION_REQUIRED: this is your own active company -- pass explicit confirmation to suspend it anyway';
  end if;

  update public.workspaces set status = 'suspended' where id = p_workspace_id;

  insert into public.company_admin_audit_log (workspace_id, actor_user_id, action, reason)
  values (p_workspace_id, auth.uid(), 'suspended', v_reason);
end;
$$;

revoke all on function public.suspend_company(uuid, text, boolean) from public;
revoke execute on function public.suspend_company(uuid, text, boolean) from anon;
grant execute on function public.suspend_company(uuid, text, boolean) to authenticated;

-- ============================================================
-- reactivate_company -- items 5, 8. No "own workspace" warning needed --
-- reactivating is the strictly safer direction (item 9 only concerns
-- accidentally locking yourself out, which reactivation cannot do).
-- ============================================================

create or replace function public.reactivate_company(p_workspace_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may reactivate a company';
  end if;

  if v_reason is null then
    raise exception 'A reason is required to reactivate a company';
  end if;

  select status into v_status from public.workspaces where id = p_workspace_id for update;
  if v_status is null then
    raise exception 'Company not found';
  end if;
  if v_status <> 'suspended' then
    raise exception 'Company is not suspended (current status: %) -- nothing to reactivate', v_status;
  end if;

  update public.workspaces set status = 'active' where id = p_workspace_id;

  insert into public.company_admin_audit_log (workspace_id, actor_user_id, action, reason)
  values (p_workspace_id, auth.uid(), 'reactivated', v_reason);
end;
$$;

revoke all on function public.reactivate_company(uuid, text) from public;
revoke execute on function public.reactivate_company(uuid, text) from anon;
grant execute on function public.reactivate_company(uuid, text) to authenticated;

commit;

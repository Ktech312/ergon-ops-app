-- Migration 187: workspace-scope the user directory and direct messages.
-- Tonight's audit flagged that `app_known_users` (migration 012) --
-- id/email of literally every user who has ever signed into the app --
-- carries a SECOND, wide-open select policy added by migration 094
-- ("authenticated read app_known_users for messaging" using (true)):
-- any authenticated user, in ANY company, can currently read the
-- full name/email of every user across EVERY company on the platform,
-- purely to populate the "start a new conversation" picker. E's
-- explicit decision tonight: this is wrong now that multiple companies
-- (workspaces) are a real concept -- a user should only be able to
-- see/message people in their OWN company.
--
-- This also REVERSES an earlier, explicit decision: migration 162's own
-- header recorded "E's other 2026-09-17 answer -- conversations/
-- direct_messages stay cross-workspace, personal messaging, not tenant
-- data -- needs NO migration at all." Tonight E reversed that call:
-- direct messages should only be possible between two people who share
-- a workspace, matching the containment model every other feature in
-- this app already uses. `PRODUCT_MASTER_COMPLETION_PLAN.md` §11 stage 4
-- should be read as superseded by this migration on that one point.
--
-- Explicitly NOT part of this migration -- a separate, larger feature
-- being researched separately, not designed or touched here in any way:
-- inviting an external person (e.g. a subcontractor from a different
-- company) into ONE SPECIFIC channel only, without broader access. Also
-- not touched: `conversations`/`direct_messages`' fixed two-participant
-- shape (a real "group DM" schema redesign is its own tracked item, per
-- migration 162's own header) -- this migration works within that
-- existing fixed-pair shape.
--
-- ============================================================
-- Design: conversations/direct_messages containment mechanism
-- ============================================================
-- Unlike every other Phase 3 "root table," `conversations` has no
-- existing owning entity to anchor a `workspace_id` on (it's a bare
-- pair of `auth.users` ids) -- the anchor here is "the workspace both
-- participants actually share," computed once at creation time, not
-- resolved per-request the way `resolve_caller_workspace_id()` resolves
-- the CALLER's own workspace (that helper only knows about the calling
-- user, not an arbitrary second participant, so it's the wrong tool
-- here). A new trigger, `guard_conversation_workspace_id_mutation()`,
-- looks up both `participant_a_id`'s and `participant_b_id`'s
-- `workspace_members` rows on INSERT and requires they share at least
-- one ACTIVE workspace -- rejecting creation outright if they don't --
-- then stamps that shared workspace onto the new row. `workspace_id` is
-- immutable after that (same pattern as every other guard trigger in
-- this schema).
--
-- Judgment call, flagged per the task's own instructions rather than
-- guessed silently: today, per this project's whole architecture so
-- far, a user belongs to at most one workspace, so "the shared
-- workspace" is unambiguous in every real case. If a user is ever a
-- member of more than one workspace in the future and the two
-- participants share MORE than one, this picks the lowest `workspace_id`
-- deterministically (`order by ... limit 1`) -- a real-but-currently-
-- moot edge case, not a business decision this migration is positioned
-- to make (which of several shared companies a cross-company DM
-- "belongs to" is a product question, not a mechanical one).
--
-- `direct_messages` itself gets NO new column -- containment flows
-- through `conversation_id` -> `conversations.workspace_id`, exactly
-- like `channel_messages` inherits ownership through `channel_id`
-- (migration 162) rather than duplicating a workspace_id onto every
-- child row.
--
-- Deliberately NOT touched by this migration, and why:
--   - `direct_message_reactions` (migration 113) and the DM-participant
--     `message-attachments` storage policies (migration 100) already
--     key off actual conversation PARTICIPANCY (an EXISTS against
--     `conversations` matching `participant_a_id`/`participant_b_id` to
--     `auth.uid()`), which this migration does not change the meaning
--     of -- a non-participant could never read these before and still
--     can't. Adding a redundant workspace predicate to them would be
--     defense-in-depth with no real gap behind it today; left alone to
--     keep this migration's footprint matched to its actual job.
--   - Multi-participant ("group DM") support stays a separate, tracked,
--     larger schema-redesign item (migration 162's header) -- not
--     attempted here.
--   - The future single-channel external-guest feature is untouched.

begin;

-- ============================================================
-- Section 1 -- app_known_users: replace migration 094's wide-open
-- messaging-picker policy with a workspace-scoped one. Migration 012's
-- separate "users and admins read directory" policy (self-or-admin) is
-- untouched -- policies of the same command are OR'd together in
-- Postgres, so total visibility becomes: self, OR global admin, OR
-- shares a workspace with the target row's user.
--
-- A new SECURITY DEFINER helper, shares_workspace_with(), does the
-- actual lookup rather than an inline EXISTS querying
-- public.workspace_members directly from this policy -- workspace_members'
-- own SELECT policy (migration 115) is itself restricted to "your own
-- row, OR a workspace/platform admin," so a plain (non-admin) caller's
-- inline query would only ever see their OWN workspace_members row, not
-- the target user's, making the join always fail for exactly the two
-- ordinary-member case this section exists to allow. Every other
-- cross-user membership check in this schema (is_workspace_admin(),
-- can_manage_workspace_member(), etc., migration 115) already solves
-- this the same way: SECURITY DEFINER, bypassing RLS on the table it
-- inspects, answering only the yes/no the calling policy actually needs.
-- ============================================================

create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members caller_wm
    join public.workspace_members target_wm on target_wm.workspace_id = caller_wm.workspace_id
    where caller_wm.user_id = auth.uid()
      and target_wm.user_id = target_user_id
  );
$$;

revoke all on function public.shares_workspace_with(uuid) from public;
revoke execute on function public.shares_workspace_with(uuid) from anon;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

drop policy if exists "authenticated read app_known_users for messaging" on public.app_known_users;

create policy "workspace members read app_known_users for messaging"
  on public.app_known_users for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_app_admin(auth.uid())
    or public.shares_workspace_with(app_known_users.user_id)
  );

-- ============================================================
-- Section 2 -- conversations: new workspace_id column, nullable for
-- now, made NOT NULL later in this same transaction (Stage 1-3 "root
-- table" pattern, same as migration 162's channels.workspace_id).
-- ============================================================

alter table public.conversations
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_conversations_workspace_id on public.conversations(workspace_id);

-- ============================================================
-- Section 3 -- Backfill: the shared workspace of both existing
-- participants, regardless of that workspace's active/suspended status
-- (backfill must not erase historical containment just because a
-- workspace was suspended after the fact -- SELECT-side RLS below uses
-- is_workspace_member(), which has no active-status requirement,
-- matching every other table's own select-vs-write asymmetry in this
-- schema). Deterministic tie-break: lowest workspace_id, matching the
-- INSERT-time trigger's own rule (see Section 5).
-- ============================================================

update public.conversations c
set workspace_id = (
  select wm_a.workspace_id
  from public.workspace_members wm_a
  join public.workspace_members wm_b on wm_b.workspace_id = wm_a.workspace_id
  where wm_a.user_id = c.participant_a_id
    and wm_b.user_id = c.participant_b_id
  order by wm_a.workspace_id
  limit 1
)
where c.workspace_id is null;

-- Any row that didn't resolve above (a participant with no workspace
-- membership at all, or two participants who never shared one --
-- neither should exist today, but this is a real, unenforced historical
-- table) falls back to the single existing workspace, same fallback
-- migration 162 used for channels it couldn't otherwise anchor.
update public.conversations
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.conversations where workspace_id is null) then
    raise exception 'backfill incomplete: conversations.workspace_id still has nulls';
  end if;
end $$;

alter table public.conversations alter column workspace_id set not null;

-- ============================================================
-- Section 4 -- Ownership trigger: computes workspace_id from the two
-- participants' shared ACTIVE workspace at INSERT time (write-path
-- parity with is_active_workspace_member()'s posture elsewhere in this
-- schema); rejects creation outright if they share none. Immutable
-- after that, same pattern as guard_workspace_id_mutation() (117) /
-- guard_channel_workspace_id_mutation() (162).
-- ============================================================

create or replace function public.guard_conversation_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_workspace_id uuid;
begin
  if TG_OP = 'INSERT' then
    select wm_a.workspace_id into shared_workspace_id
    from public.workspace_members wm_a
    join public.workspace_members wm_b on wm_b.workspace_id = wm_a.workspace_id
    join public.workspaces w on w.id = wm_a.workspace_id
    where wm_a.user_id = new.participant_a_id
      and wm_b.user_id = new.participant_b_id
      and w.status = 'active'
    order by wm_a.workspace_id
    limit 1;

    if shared_workspace_id is null then
      raise exception 'conversation participants must share an active workspace';
    end if;

    new.workspace_id := shared_workspace_id;
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

revoke all on function public.guard_conversation_workspace_id_mutation() from public;

drop trigger if exists conversations_guard_workspace_id on public.conversations;
create trigger conversations_guard_workspace_id
  before insert or update on public.conversations
  for each row execute function public.guard_conversation_workspace_id_mutation();

-- ============================================================
-- Section 5 -- conversations RLS: workspace predicate added ALONGSIDE
-- the existing participant check, not replacing it -- a participant who
-- later leaves the workspace loses read access same as everywhere else
-- in this schema, and (belt-and-suspenders) a non-participant workspace-
-- mate still can't read someone else's DM just by sharing a workspace.
-- ============================================================

drop policy if exists "participants read their conversations" on public.conversations;
create policy "workspace participants read their conversations"
  on public.conversations for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (auth.uid() = participant_a_id or auth.uid() = participant_b_id)
  );

drop policy if exists "participants create their conversations" on public.conversations;
create policy "workspace participants create their conversations"
  on public.conversations for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (auth.uid() = participant_a_id or auth.uid() = participant_b_id)
  );

-- ============================================================
-- Section 6 -- direct_messages RLS: same workspace predicate added
-- inside each existing conversations EXISTS subquery (mirrors migration
-- 162's channel_messages treatment exactly).
-- ============================================================

drop policy if exists "participants read their messages" on public.direct_messages;
create policy "workspace participants read their messages"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

drop policy if exists "participants send messages in their conversations" on public.direct_messages;
create policy "workspace participants send messages in their conversations"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_active_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

drop policy if exists "recipients mark messages read" on public.direct_messages;
create policy "workspace recipients mark messages read"
  on public.direct_messages for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - direct_message_reactions and the DM-participant message-
--     attachments storage policies (migration 100) -- already correctly
--     participant-scoped, no gap behind them to close.
--   - Multi-participant ("group DM") schema redesign -- separate,
--     tracked item.
--   - The future single-channel external-guest invite feature -- a
--     distinct, larger feature being researched separately.
--   - Frontend: src/persistence.ts's loadAllKnownUsers()/
--     getOrCreateConversation() do plain unfiltered REST reads/writes
--     and rely entirely on RLS for scoping (no explicit workspace_id
--     filter, no hardcoded single-workspace assumption) -- verified by
--     reading the real code, not assumed. The directory picker and "new
--     conversation" flow narrow to workspace-mates automatically once
--     this migration is applied, with no frontend change required.
-- ============================================================

-- Phase 3, Stage 4 -- messaging channels workspace scoping. Approved by
-- E under the same 2026-09-16 standing authorization as migrations
-- 155-161, following E's explicit 2026-09-17 decision on the one open
-- product question this sub-area was blocked on: channels are
-- PER-WORKSPACE, not shared globally -- each workspace gets its own
-- copy of the 4 section channels and its own group channels, matching
-- how every other table in this app already works.
--
-- (E's other 2026-09-17 answer -- conversations/direct_messages stay
-- cross-workspace, personal messaging, not tenant data -- needs NO
-- migration at all; that table is correctly left exactly as-is. E also
-- asked for direct_messages/conversations to support more than two
-- participants, Slack/Teams-style -- that is a real, separate feature
-- (schema redesign: conversations' fixed participant_a_id/
-- participant_b_id pair would need to become a real membership table,
-- plus frontend UI work), not a workspace-scoping question, and is
-- DELIBERATELY NOT done by this migration -- tracked as a new item in
-- PRODUCT_MASTER_COMPLETION_PLAN.md, not bundled into Phase 3.)
--
-- Table-group scope: `channels` gets a real, trigger-enforced
-- `workspace_id` column -- unlike every other Stage 4 table, `channels`
-- has two types (`section`, `group`) with no reliable FK anchor at all,
-- so (unlike `project_documents`' coalesce-via-resolver treatment) this
-- needs a genuine column, matching the Stage 1-3 "root table" pattern
-- instead. `channel_messages`, `channel_members`, `channel_canvas`,
-- `channel_message_reactions`, and the `message-attachments` storage
-- bucket's channel-specific policies all inherit ownership through
-- `channel_id` (no new column), exactly like every prior stage's
-- children.
--
-- Backfill anchor priority per channel type, re-verified directly
-- against current source (migrations 101/102/105), not assumed:
--   - `type = 'project'` -- the linked project's workspace (already
--     real since migration 156).
--   - `type = 'client'` -- the linked client's workspace (already real
--     since migration 117).
--   - `type = 'group'` -- the creator's own single active workspace
--     membership (`created_by`, migration 105), the same derivation
--     already used for `tasks.workspace_id` in migration 156, falling
--     back to the single existing active workspace for any unresolvable
--     row (no creator recorded, or an ambiguous/missing membership).
--   - `type = 'section'` -- no anchor at all (4 seeded singletons,
--     migration 101) -- single existing active workspace only.
--
-- Ownership trigger: `channels` does NOT reuse `guard_workspace_id_mutation()`
-- verbatim (unlike every prior table) -- that shared trigger
-- unconditionally overwrites `workspace_id` from
-- `resolve_caller_workspace_id()` on every INSERT, which is wrong for
-- `type IN ('project', 'client')` rows: `create_project_channel()`/
-- `create_client_channel()` (migrations 101/102) insert a channel
-- programmatically at the moment a project/client is created, and the
-- AUTHORITATIVE workspace for that channel is the project's/client's own
-- `workspace_id`, not necessarily identical to whatever
-- `resolve_caller_workspace_id()` would separately resolve for the
-- calling user (true today, with exactly one workspace, but not
-- guaranteed once a second workspace exists). A new, channel-specific
-- guard (`guard_channel_workspace_id_mutation()`) derives `workspace_id`
-- from the linked `projects`/`clients` row for those two types
-- (ignoring any caller-supplied value entirely, same trust posture as
-- the shared guard), and falls back to `resolve_caller_workspace_id()`
-- for `section`/`group` types, exactly like the shared guard would.
--
-- Deliberately NOT done by this migration: auto-creating a new
-- workspace's own 4 section channels the moment that workspace is
-- created. There is no reviewed, trusted workspace-creation path yet
-- (Stage 7, "company onboarding and no-code workspace configuration,"
-- has not started) -- bolting an AFTER INSERT trigger onto `workspaces`
-- now, before that path exists, would either (a) need to trust a
-- caller-supplied `workspace_id` on the seeded rows, which the guard
-- trigger above must NOT do for `section`/`group` types without
-- reopening exactly the cross-tenant spoofing gap this whole migration
-- closes, or (b) invent a bypass mechanism (a session-local GUC flag)
-- that a malicious `authenticated` caller could potentially set
-- themselves before their own request, since Postgres does not
-- privilege-gate `set_config()` by default. Correctly solving this
-- belongs with Stage 7's own reviewed, security-definer workspace
-- provisioning procedure, not a bare trigger added in isolation here.
-- Tracked in `PRODUCT_MASTER_COMPLETION_PLAN.md` §11's Stage 7 entry.
--
-- Also deliberately NOT done: fixing `channel_members`' and
-- `channel_canvas`' own separate, pre-existing authorization gaps
-- (`channel_members` is fully open on all three operations -- anyone
-- can add/remove anyone from any channel's membership list;
-- `channel_canvas` is fully open rather than membership-gated like
-- `channel_messages` was tightened to be in migration 105) -- both
-- flagged during Stage 4 scoping as real bugs, but a different
-- authorization dimension (intra-workspace membership enforcement) than
-- this migration's job (cross-workspace containment). This migration
-- DOES add the workspace predicate to both, alongside their existing
-- (over-broad) `using(true)` logic -- closing the cross-TENANT leak
-- without also fixing the separate intra-workspace gap, which needs its
-- own review.
--
-- Confirm 162 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, made NOT NULL later in this
-- same transaction.
-- ============================================================

alter table public.channels
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_channels_workspace_id on public.channels(workspace_id);

-- ============================================================
-- Section 2 -- New owner-resolver helper functions, reused by
-- channel_members/channel_canvas below. client_owner_workspace_id() is
-- new (no prior stage needed one -- clients is itself the root table);
-- channel_owner_workspace_id() resolves a channel's own workspace_id,
-- now a real column, for its one-level children.
-- ============================================================

create or replace function public.client_owner_workspace_id(p_client_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.clients where id = p_client_id;
$$;

create or replace function public.channel_owner_workspace_id(p_channel_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.channels where id = p_channel_id;
$$;

revoke execute on function public.client_owner_workspace_id(uuid) from public;
revoke execute on function public.channel_owner_workspace_id(uuid) from public;
grant execute on function public.client_owner_workspace_id(uuid) to authenticated;
grant execute on function public.channel_owner_workspace_id(uuid) to authenticated;

-- ============================================================
-- Section 3 -- Backfill, in dependency order (channels itself first,
-- since its children's resolver reads channels.workspace_id).
-- ============================================================

update public.channels c
set workspace_id = p.workspace_id
from public.projects p
where c.type = 'project'
  and c.project_id = p.id
  and c.workspace_id is null;

update public.channels c
set workspace_id = cl.workspace_id
from public.clients cl
where c.type = 'client'
  and c.client_id = cl.id
  and c.workspace_id is null;

-- group channels: prefer the creator's own single active workspace
-- membership, same derivation as tasks.workspace_id (migration 156).
update public.channels c
set workspace_id = wm.workspace_id
from public.workspace_members wm
where c.type = 'group'
  and c.created_by = wm.user_id
  and c.workspace_id is null
  and (select count(*) from public.workspace_members wm2 where wm2.user_id = c.created_by) = 1;

-- Everything else (section channels, and any project/client/group row
-- that didn't resolve above -- a dangling FK, no creator recorded, or
-- an ambiguous membership) falls back to the single existing active
-- workspace.
update public.channels
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- ============================================================
-- Section 4 -- In-migration assertion: abort the whole transaction if
-- the backfill missed anything.
-- ============================================================

do $$
begin
  if exists (select 1 from public.channels where workspace_id is null) then
    raise exception 'backfill incomplete: channels.workspace_id still has nulls';
  end if;
end $$;

-- ============================================================
-- Section 5 -- Channel-specific ownership trigger. See this file's
-- header for why this does NOT reuse guard_workspace_id_mutation()
-- verbatim.
-- ============================================================

create or replace function public.guard_channel_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if new.type = 'project' then
      new.workspace_id := (select workspace_id from public.projects where id = new.project_id);
    elsif new.type = 'client' then
      new.workspace_id := (select workspace_id from public.clients where id = new.client_id);
    else
      -- section/group: never trust a caller-supplied value, same
      -- fail-closed posture as guard_workspace_id_mutation().
      new.workspace_id := public.resolve_caller_workspace_id();
    end if;
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

revoke all on function public.guard_channel_workspace_id_mutation() from public;

drop trigger if exists channels_guard_workspace_id on public.channels;
create trigger channels_guard_workspace_id
  before insert or update on public.channels
  for each row execute function public.guard_channel_workspace_id_mutation();

-- ============================================================
-- Section 6 -- Enforce NOT NULL, now that every existing row is
-- verified non-null (Section 4) and every future write is
-- trigger-protected (Section 5), both within this same transaction.
-- ============================================================

alter table public.channels alter column workspace_id set not null;

-- ============================================================
-- Section 7 -- Uniqueness: section channels are singletons PER
-- WORKSPACE now, not globally -- a second workspace must be able to
-- seed its own 'inventory'/'projects'/'sales'/'marketing' section
-- channels without colliding with the first workspace's. (type,
-- client_id) and (type, project_id) need no change -- a client/project
-- id already uniquely determines a single workspace on its own.
-- ============================================================

alter table public.channels drop constraint if exists channels_type_section_key_key;
alter table public.channels add constraint channels_type_section_key_key unique (type, section_key, workspace_id);

-- ============================================================
-- Section 8 -- channels RLS: workspace predicate added ALONGSIDE every
-- existing visibility rule (open types vs. private-group membership),
-- not replacing it.
-- ============================================================

drop policy if exists "authenticated read open channels" on public.channels;
create policy "workspace members read open channels" on public.channels for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (type in ('section', 'project', 'client') or (type = 'group' and private = false))
  );

drop policy if exists "authenticated read private group channels" on public.channels;
create policy "workspace members read private group channels" on public.channels for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and type = 'group'
    and private = true
    and (
      created_by = auth.uid()
      or exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
    )
  );

drop policy if exists "authenticated write channels" on public.channels;
create policy "workspace members insert channels" on public.channels for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "authenticated update channels" on public.channels;
create policy "workspace members update channels" on public.channels for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 9 -- channel_messages RLS: same workspace predicate added
-- inside each existing visibility EXISTS subquery.
-- ============================================================

drop policy if exists "authenticated read channel_messages" on public.channel_messages;
create policy "workspace members read channel_messages" on public.channel_messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_messages.channel_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated send channel_messages" on public.channel_messages;
create policy "workspace members send channel_messages" on public.channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = channel_messages.channel_id
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

-- ============================================================
-- Section 10 -- channel_members, channel_canvas RLS: workspace
-- predicate added via channel_owner_workspace_id(), alongside the
-- existing using(true)/with check(true) -- their separate,
-- non-workspace authorization gap (see this file's header) is
-- deliberately not fixed here.
-- ============================================================

drop policy if exists "authenticated read channel_members" on public.channel_members;
create policy "workspace members read channel_members" on public.channel_members for select to authenticated
  using (public.is_workspace_member(public.channel_owner_workspace_id(channel_id)));

drop policy if exists "authenticated write channel_members" on public.channel_members;
create policy "workspace members write channel_members" on public.channel_members for insert to authenticated
  with check (public.is_active_workspace_member(public.channel_owner_workspace_id(channel_id)));

drop policy if exists "authenticated delete channel_members" on public.channel_members;
create policy "workspace members delete channel_members" on public.channel_members for delete to authenticated
  using (public.is_active_workspace_member(public.channel_owner_workspace_id(channel_id)));

drop policy if exists "authenticated read channel_canvas" on public.channel_canvas;
drop policy if exists "authenticated write channel_canvas" on public.channel_canvas;
drop policy if exists "authenticated update channel_canvas" on public.channel_canvas;

create policy "workspace members read channel_canvas" on public.channel_canvas for select to authenticated
  using (public.is_workspace_member(public.channel_owner_workspace_id(channel_id)));

create policy "workspace members insert channel_canvas" on public.channel_canvas for insert to authenticated
  with check (public.is_active_workspace_member(public.channel_owner_workspace_id(channel_id)));

create policy "workspace members update channel_canvas" on public.channel_canvas for update to authenticated
  using (public.is_active_workspace_member(public.channel_owner_workspace_id(channel_id)))
  with check (public.is_active_workspace_member(public.channel_owner_workspace_id(channel_id)));

-- ============================================================
-- Section 11 -- channel_message_reactions RLS: same workspace predicate
-- inside its existing visibility EXISTS subqueries (mirrors
-- channel_messages' own scoping exactly, migration 113's own stated
-- design intent). direct_message_reactions is untouched -- it mirrors
-- direct_messages/conversations, which stay deliberately cross-workspace
-- per E's 2026-09-17 decision.
-- ============================================================

drop policy if exists "authenticated read channel_message_reactions" on public.channel_message_reactions;
create policy "workspace members read channel_message_reactions" on public.channel_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.channel_messages m
      join public.channels c on c.id = m.channel_id
      where m.id = channel_message_reactions.message_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated add own channel_message_reactions" on public.channel_message_reactions;
create policy "workspace members add own channel_message_reactions" on public.channel_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.channel_messages m
      join public.channels c on c.id = m.channel_id
      where m.id = channel_message_reactions.message_id
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
        )
    )
  );

-- "authenticated remove own channel_message_reactions" (DELETE,
-- using(user_id = auth.uid()) only) is untouched -- a user removing
-- their OWN reaction needs no workspace check beyond ownership, and the
-- row could not have been created in the wrong workspace in the first
-- place per the INSERT policy just tightened above.

-- ============================================================
-- Section 12 -- message-attachments storage bucket, channel-specific
-- policies only (the DM-participant policies from migration 100 stay
-- untouched -- conversations/direct_messages stay cross-workspace).
-- ============================================================

drop policy if exists "authenticated read channel message-attachments" on storage.objects;
create policy "workspace members read channel message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.channels c
      where storage.objects.name like c.id::text || '/%'
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated write channel message-attachments" on storage.objects;
create policy "workspace members write channel message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.channels c
      where storage.objects.name like c.id::text || '/%'
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - No auto-seeding of a new workspace's own section channels --
--     belongs to Stage 7's own reviewed provisioning procedure.
--   - channel_members' and channel_canvas' separate, pre-existing
--     over-broad authorization gaps (not workspace-related) are
--     untouched beyond adding the workspace predicate alongside them.
--   - conversations/direct_messages/direct_message_reactions are
--     entirely untouched -- deliberately cross-workspace per E's
--     2026-09-17 decision, and multi-participant ("group DM") support
--     is a separate, real feature (schema redesign + frontend work),
--     tracked as a new item, not part of Phase 3.
--   - create_project_channel()/create_client_channel() (migrations
--     101/102) need no changes -- the new guard trigger correctly
--     derives workspace_id for their INSERT paths without any RPC-side
--     change.
-- ============================================================

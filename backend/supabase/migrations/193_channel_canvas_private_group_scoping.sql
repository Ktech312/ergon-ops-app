-- Migration 193: channel_canvas's private-group membership gap, flagged
-- since migration 162 itself ("Two pre-existing bugs found in passing,
-- NOT fixed by this migration") and re-confirmed unresolved by
-- PRODUCT_MASTER_COMPLETION_PLAN.md's own Stage 4 write-up, then
-- independently re-verified against the LIVE migration files (not the
-- plan's prose, which describes it imprecisely as "fully open (using(true))"
-- -- that was already fixed by 162 itself; the real, current gap is
-- narrower) during a 2026-09-22 doc-accuracy audit.
--
-- ============================================================
-- The gap
-- ============================================================
-- channel_messages' own SELECT/INSERT policies (162, tightened further by
-- 188) already require, for a PRIVATE group channel specifically, a real
-- channel_members row -- a workspace member who isn't in a private
-- group's membership list cannot read or send its messages. channel_canvas
-- (104, workspace-scoped by 162, guest SELECT added by 188) never got this
-- same private-group check on ANY of its three policies -- it only checks
-- `is_workspace_member(workspace_id)`/`is_active_workspace_member(workspace_id)`,
-- full stop. Net effect: any workspace member can read AND EDIT a private
-- group channel's canvas even without being a member of that channel --
-- the exact kind of shared team doc a private group exists to keep
-- restricted, and a real gap between what "private" means for messages
-- vs. canvas in the same channel.
--
-- ============================================================
-- The fix
-- ============================================================
-- Replace all three channel_canvas policies with the exact same
-- authorization predicate channel_messages already uses (re-read directly
-- from 188_external_channel_guest_access.sql:455-469 before writing this,
-- not assumed) -- workspace member AND (section/project/client channel,
-- OR a non-private group channel, OR a real channel_members row for a
-- private group), joined against `channels` directly instead of going
-- through the coarser `channel_owner_workspace_id()` resolver the old
-- policies used (that resolver only ever returns a workspace_id, with no
-- way to also see the channel's own type/private columns).
--
-- INSERT/UPDATE deliberately do NOT gain the `is_active_channel_guest()`
-- OR-branch that SELECT gets -- migration 188's own header is explicit
-- that canvas is read-only for guests ("a guest's contribution as
-- messages/files ... never canvas editing"), and this migration is a pure
-- containment fix, not a re-opening of that already-made product decision.
-- SELECT keeps its existing guest branch unchanged.
--
-- No new column, no new table, no product decision -- this closes an
-- inconsistency between two already-decided authorization boundaries on
-- sibling tables of the same channel, the same class of fix as migrations
-- 161/166/169/171/186 before it (each found "in passing" during an
-- unrelated pass and closed without a separate business decision, since
-- none of them changed WHO is allowed to do WHAT, only made an already-
-- decided rule actually apply everywhere it was supposed to).

begin;

drop policy if exists "workspace members read channel_canvas" on public.channel_canvas;
create policy "workspace members read channel_canvas" on public.channel_canvas for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_canvas.channel_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
    or public.is_active_channel_guest(channel_canvas.channel_id)
  );

drop policy if exists "workspace members insert channel_canvas" on public.channel_canvas;
create policy "workspace members insert channel_canvas" on public.channel_canvas for insert to authenticated
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_canvas.channel_id
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "workspace members update channel_canvas" on public.channel_canvas;
create policy "workspace members update channel_canvas" on public.channel_canvas for update to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_canvas.channel_id
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_canvas.channel_id
        and public.is_active_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

commit;

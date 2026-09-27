-- Migration 216: Phase 2C (part 2) -- proposal_template_sections,
-- per E's own explicit decision: "Add workspace_id, assign existing
-- rows only to Ergon's workspace, enforce workspace-scoped RLS, and
-- build Admin controls to create, edit, reorder, and delete template
-- sections. K-Tech and future companies must start empty unless their
-- admin explicitly creates or imports templates. Never automatically
-- copy Ergon's boilerplate into another company. Existing sent
-- proposal snapshots must remain unchanged if a template is later
-- edited or deleted."
--
-- The last point is already true by construction, confirmed directly
-- against the real code, not assumed: createAndSendQuoteProposalVersion
-- freezes section content into content_snapshot at send time (see
-- handleReorderProposalTemplateSection's own comment, main.tsx) -- a
-- later edit, reorder, or delete of the LIVE template row can never
-- retroactively change a proposal already sent, since a sent proposal
-- never reads the live table again. This migration's DELETE capability
-- does not need any special handling to preserve that guarantee; it
-- already holds.
--
-- Schema: adds workspace_id (backfilled to the one pre-existing
-- workspace -- the same structural identification migration 211
-- already established: the one workspace never referenced by any
-- company_signup_requests row -- then locked NOT NULL), replaces the
-- old globally-unique `section_key` with `unique(workspace_id,
-- section_key)`, and gives section_key a random default so the
-- frontend's create action never needs to invent one (it was always a
-- machine key, never shown to users). A new INSERT/UPDATE trigger
-- (guard_workspace_id_mutation(), already generic and reused verbatim
-- from migration 117 -- not redefined here) stamps workspace_id from
-- the caller's own resolved workspace and forbids ever changing it
-- afterward, exactly like every other workspace-owned content table
-- in this schema.
--
-- RLS: read scoped to workspace membership (was `using (true)` --
-- every company could read every other company's boilerplate before
-- this); write scoped the same way migration 213 already established
-- for the rest of this app (is_active_workspace_member AND (is_app_admin
-- OR is_workspace_admin OR has_role('manager'))) -- the manager branch
-- is this table's own pre-existing condition, preserved exactly, not
-- newly added.

begin;

alter table public.proposal_template_sections
  add column if not exists workspace_id uuid references public.workspaces(id);

update public.proposal_template_sections
set workspace_id = (
  select id from public.workspaces
  where id not in (
    select created_workspace_id
    from public.company_signup_requests
    where created_workspace_id is not null
  )
  order by created_at asc
  limit 1
)
where workspace_id is null;

alter table public.proposal_template_sections
  alter column workspace_id set not null;

alter table public.proposal_template_sections
  drop constraint if exists proposal_template_sections_section_key_key;

alter table public.proposal_template_sections
  add constraint proposal_template_sections_workspace_section_key_key unique (workspace_id, section_key);

alter table public.proposal_template_sections
  alter column section_key set default gen_random_uuid()::text;

drop trigger if exists proposal_template_sections_guard_workspace_id on public.proposal_template_sections;
create trigger proposal_template_sections_guard_workspace_id
  before insert or update on public.proposal_template_sections
  for each row execute function public.guard_workspace_id_mutation();

drop policy if exists "authenticated read proposal_template_sections" on public.proposal_template_sections;
create policy "workspace members read proposal_template_sections" on public.proposal_template_sections for select to authenticated
  using (is_workspace_member(workspace_id));

drop policy if exists "admin/manager write proposal_template_sections" on public.proposal_template_sections;
create policy "workspace members: admin/manager write proposal_template_sections" on public.proposal_template_sections for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('manager')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('manager')));

commit;

-- Confirm 216 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept
-- local for E's review.

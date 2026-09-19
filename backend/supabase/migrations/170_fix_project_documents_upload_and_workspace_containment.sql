-- URGENT. Phase 3, Stage 5 (workspace-scoped uniqueness, reports,
-- aggregates, functions, triggers, and remaining indirect access
-- paths) -- sixth migration of this stage, same 2026-09-16 standing
-- authorization as migrations 155-169. Originally scoped as a routine
-- continuation of migration 164's workspace-scoped-uniqueness work
-- (`project_documents.document_number` was the one column migration
-- 164 deliberately excluded, since this table has no `workspace_id`
-- column at all). Scoping this properly surfaced a LIVE INCIDENT of the
-- same severity class as migrations 165/168, confirmed empirically
-- before writing this fix, not just inferred from reading code:
--
--   ERROR: new row violates row-level security policy for table
--   "project_documents"
--
-- `project_documents` has THREE nullable anchors (`project_id`,
-- `purchase_order_id`, `purchase_request_id`) and is currently scoped
-- only indirectly, at query time, via `project_document_owner_
-- workspace_id()` (migration 161), a three-way `coalesce()` over those
-- anchors. Migration 161's own INSERT policy uses the identical
-- coalesce inline in its `with check`. Two facts, both re-confirmed
-- directly from source (`src/persistence.ts`) before writing this, make
-- that coalesce resolve to NULL for the app's own documented MOST
-- COMMON case:
--
--   1. `project_id` is effectively dead for new rows -- neither of the
--      two real write paths (`createProjectDocuments()`,
--      `saveRestoredProjectDocuments()`) ever sets it; the
--      `ProjectDocument` TypeScript type has no `projectId` field at
--      all. The only rows that ever had it are migration 017's one-time
--      legacy backfill.
--   2. A plain "general project document" -- migration 080's own header
--      comment: "most documents (general project files) link to
--      neither [PO nor PR]" -- sets NEITHER `purchase_order_id` NOR
--      `purchase_request_id` either.
--
-- So for this app's own most common document-upload case, ALL THREE
-- anchors are null, `coalesce(...)` is null, and `is_active_workspace_
-- member(null)` is false -- migration 161's INSERT policy rejects the
-- insert outright. Since migration 161 has been live since 2026-09-17,
-- every attempt to upload a general project document has almost
-- certainly been failing since then. Confirmed empirically: reproduced
-- migration 161's exact policy shape against the exact no-anchor
-- payload `createProjectDocuments()` actually sends, against a real
-- local PostgreSQL 18 engine (PGlite) -- rejected, exactly as predicted.
--
-- Fix: give `project_documents` a real `workspace_id` column, like
-- every other Stage 1-4 root/anchored table, instead of relying purely
-- on query-time anchor resolution. Derivation trigger (modeled directly
-- on migration 162's `guard_channel_workspace_id_mutation()`, the
-- established pattern for "more than one possible anchor" tables):
-- prefer whichever of the three anchors is set, in the SAME priority
-- order the existing coalesce already uses (project_id, then
-- purchase_order_id, then purchase_request_id -- preserved exactly,
-- not re-litigated here, since whether these anchors could ever
-- disagree with each other when more than one is set was flagged during
-- scoping as needing a live-database check this migration does not
-- depend on: it only changes behavior for the zero-anchor case, which
-- is the confirmed, demonstrated bug); when NONE are set, fall back to
-- the CALLER's own resolved workspace via `resolve_caller_workspace_id()`
-- -- this is the one behavioral change, and it is exactly what fixes
-- the incident (a general document now gets the uploader's own
-- workspace, instead of no workspace at all).
--
-- With a real column in place, RLS policies switch from the inline
-- three-way coalesce to a plain `is_workspace_member(workspace_id)`/
-- `is_active_workspace_member(workspace_id)` check, matching every
-- other Stage 1-4 table -- and `document_number`'s global unique
-- constraint (migration 002, never touched since -- the original,
-- narrower goal of this migration before the incident was found) is
-- finally closeable as a composite `(workspace_id, document_number)`
-- constraint, same pattern as migration 164's other nine columns.
-- `project_document_owner_workspace_id()` (migration 161, still used by
-- `sales_quote_extractions`, which has no anchor columns of its own) is
-- simplified to read the new direct column -- same external behavior,
-- no design change for that table.
--
-- Confirm 170 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- URGENT, live
-- incident, same severity class as migrations 165/168.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL in this same transaction (same three-step shape as
-- every other Stage 1-4 workspace_id rollout).
-- ============================================================

alter table public.project_documents
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_project_documents_workspace_id on public.project_documents(workspace_id);

-- ============================================================
-- Section 2 -- Backfill. Same three-way preference as the resolver this
-- replaces; a historical row (no live "caller" to fall back to) that
-- still resolves to nothing after that falls back to this database's
-- one existing workspace, same pattern as every other Stage 1-4
-- backfill.
-- ============================================================

update public.project_documents pd
set workspace_id = coalesce(
  (select p.workspace_id from public.projects p where p.id = pd.project_id),
  (select po.workspace_id from public.purchase_orders po where po.id = pd.purchase_order_id),
  (select pr.workspace_id from public.purchase_requests pr where pr.id = pd.purchase_request_id)
)
where pd.workspace_id is null;

update public.project_documents
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.project_documents where workspace_id is null) then
    raise exception 'backfill incomplete: project_documents.workspace_id still has nulls';
  end if;
end $$;

alter table public.project_documents alter column workspace_id set not null;

-- ============================================================
-- Section 3 -- Derivation trigger. Modeled directly on migration 162's
-- guard_channel_workspace_id_mutation() -- the established pattern for
-- a table with more than one possible workspace anchor. The ONE
-- behavioral change from the resolver it replaces: when none of the
-- three anchors are set, this now falls back to the caller's own
-- resolved workspace instead of leaving the row unscoped -- this is
-- exactly what fixes the incident described in this file's header.
-- ============================================================

create or replace function public.guard_project_document_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := coalesce(
      (select workspace_id from public.projects where id = new.project_id),
      (select workspace_id from public.purchase_orders where id = new.purchase_order_id),
      (select workspace_id from public.purchase_requests where id = new.purchase_request_id),
      public.resolve_caller_workspace_id()
    );
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

revoke all on function public.guard_project_document_workspace_id_mutation() from public;

drop trigger if exists project_documents_guard_workspace_id on public.project_documents;
create trigger project_documents_guard_workspace_id
  before insert or update on public.project_documents
  for each row execute function public.guard_project_document_workspace_id_mutation();

-- ============================================================
-- Section 4 -- RLS: replace the three-way-coalesce policies (migration
-- 161) with a plain workspace_id check, matching every other Stage 1-4
-- table now that a real column exists. Same role gate as before (none
-- -- migration 023's original decision, preserved verbatim by migration
-- 161: uploading/reviewing documents isn't clearly a single role's job).
-- ============================================================

drop policy if exists "workspace members read project_documents" on public.project_documents;
drop policy if exists "workspace members insert project_documents" on public.project_documents;
drop policy if exists "workspace members update project_documents" on public.project_documents;
drop policy if exists "workspace members delete project_documents" on public.project_documents;

create policy "workspace members read project_documents"
  on public.project_documents for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert project_documents"
  on public.project_documents for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update project_documents"
  on public.project_documents for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete project_documents"
  on public.project_documents for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 5 -- project_document_owner_workspace_id(): simplified to
-- read the new direct column. Still used by sales_quote_extractions'
-- own RLS (migration 161), which has no anchor columns of its own --
-- same external signature and behavior, no design change for that
-- table.
-- ============================================================

create or replace function public.project_document_owner_workspace_id(p_project_document_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.project_documents where id = p_project_document_id;
$$;

-- ============================================================
-- Section 6 -- document_number: the original, narrower goal of this
-- migration before the incident above was found. Global unique
-- constraint (migration 002, never touched since) swapped for a
-- composite (workspace_id, document_number) equivalent, same pattern
-- as migration 164's other nine columns.
-- ============================================================

alter table public.project_documents drop constraint project_documents_document_number_key;
alter table public.project_documents add constraint project_documents_workspace_id_document_number_key unique (workspace_id, document_number);

commit;

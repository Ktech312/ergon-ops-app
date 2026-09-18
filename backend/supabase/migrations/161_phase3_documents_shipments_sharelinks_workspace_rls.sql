-- Phase 3, Stage 4 -- UNBLOCKED PORTION ONLY (Documents, shipments,
-- share-link records, and the one storage bucket migration 160 named as
-- deferred) -- approved by E under the same 2026-09-16 standing
-- authorization as migrations 155-160. This is NOT all of Stage 4.
--
-- Stage 4's full name is "Documents, notifications, channels, jobs, and
-- share-link records, and storage." A dedicated scoping pass across all
-- 160 prior migrations found two sub-areas that are genuine PRODUCT
-- decisions, not routine implementation defaults, and are deliberately
-- NOT touched by this migration -- they need E's input before any
-- schema work on them is written:
--   1. Messaging channels (`channels`/`channel_messages`/`channel_canvas`/
--      `channel_members`, migrations 094/100-105/112/113) -- `section`
--      (4 global singletons: inventory/projects/sales/marketing) and
--      `group` (ad-hoc user-created) channel types have no workspace
--      anchor of any kind. Whether every workspace gets its own copy of
--      the section channels, or all workspaces share one, changes real
--      behavior the moment a second workspace exists -- not a call this
--      migration makes unilaterally.
--   2. `conversations`/`direct_messages` (private 1:1 DMs, migrations
--      094/100) -- both participants are raw `auth.users` references
--      with no workspace concept. Whether DMs become workspace-scoped or
--      deliberately stay cross-workspace (personal messaging, not tenant
--      data) is the same class of open product decision.
-- Both are tracked in `PRODUCT_MASTER_COMPLETION_PLAN.md` §11's Stage 4
-- entry, unchanged by this migration, pending E's read.
--
-- Also deliberately NOT touched, confirmed correct to exclude on direct
-- read (not assumed):
--   - `notifications`/`notification_deliveries` -- `notifications` has NO
--     anchor of any kind (`recipient_email` is plain text, not FK;
--     `related_entity_type`/`related_entity_id` is a polymorphic pair
--     with no FK). Its SELECT/UPDATE policies are already correctly
--     self-scoped by recipient email (`lower(recipient_email) = lower(jwt
--     email)`), which is the RIGHT boundary for a message addressed to
--     one specific person -- adding workspace scoping on top would add
--     no real security (an email uniquely identifies one auth.users row,
--     never shared across workspaces) and INSERT is already closed to
--     `authenticated` since migration 114 (service-role API route only).
--     `notification_deliveries` being fully open (read+insert to any
--     authenticated user) IS a real gap, but it is a general
--     access-control gap unrelated to workspace containment (the fix is
--     "scope reads to the notification's own recipient," not "add a
--     workspace_id") -- out of this migration's theme, flagged in
--     `PRODUCT_MASTER_COMPLETION_PLAN.md` for its own pass.
--   - `push_subscriptions` -- already correctly self-scoped to
--     `auth.uid()`, a device subscription has no workspace concept.
--   - `notification_rules` -- very likely Stage 5's job (global,
--     admin-configured event-type whitelist, no per-row tenant data,
--     same shape as `standard_install_times`/`project_schedule_templates`,
--     both already excluded from Stage 2 for the identical reason,
--     migration 156's own header) -- not touched here either way.
--   - "Jobs" -- confirmed via repo-wide grep: no job queue, cron table,
--     or webhook log exists anywhere in this codebase. Nothing to
--     migrate under this name.
--
-- Table-group scope, this migration:
--   - `project_documents` -- THREE nullable FK anchors
--     (`project_id`/`purchase_order_id`/`purchase_request_id`, no
--     combination guaranteed non-null), resolved inline via a three-way
--     coalesce, same shape as migration 160's `inventory_transactions`.
--     Still no role gate -- migration 023 deliberately left this table
--     un-role-gated ("uploading/reviewing documents isn't clearly a
--     single role's job"), preserved exactly.
--   - `sales_quote_extractions` -- anchors two hops out via
--     `project_document_id -> project_documents`, resolved via a new
--     `project_document_owner_workspace_id()` resolver that performs the
--     same three-way coalesce for a given document row. No role gate,
--     matches current shape.
--   - `project_shipping_addresses`, `project_shipments` -- clean single
--     anchor (`project_id not null`), reuse migration 157's
--     `project_owner_workspace_id()` directly, no new resolver. No role
--     gate -- confirmed absent from migration 023's list, still
--     `using(true)` today.
--   - `project_shipment_lines`, `project_shipment_photos` -- one-level
--     children of `project_shipments` (`shipment_id not null`), new
--     `project_shipment_owner_workspace_id()` resolver. No role gate.
--   - `purchase_order_files` storage bucket (`storage.objects`, bucket
--     id `purchase-order-files`) -- the TABLE's own RLS was scoped in
--     migration 160; migration 160's own header named this bucket's
--     object policies as the one deliberately deferred Stage 4 item.
--     Scoped here by joining `storage.objects.name` directly against
--     `purchase_order_files.storage_path` (an exact-match join against
--     the real metadata row, not a filename-prefix convention -- more
--     precise than the prefix-matching pattern migrations 100/105 used
--     for `message-attachments`, which had no such metadata table to
--     join against).
--   - `public_share_tokens`, `share_link_views`, `share_link_actions` --
--     confirmed real gap: migration 158 hardened the RPC layer with real
--     workspace containment, but these three tables' own SELECT policies
--     (the only policies left on any of them, since migration 144 closed
--     direct writes to RPC-only) are still bare `using(true)` -- any
--     authenticated user in ANY workspace can read every OTHER
--     workspace's share-token/view-log/action-log rows via a raw REST
--     select today. Fixed by reusing migration 158's own
--     `share_link_entity_workspace_id(entity_type, entity_id)` helper
--     directly -- no new resolver needed, it already does exactly this
--     resolution and is already granted to `authenticated`. No write
--     policy is added to any of the three -- they remain RPC-only,
--     unchanged.
--   - `workspace_share_link_settings` -- already has `workspace_id` as
--     its own PK (migration 137), the one table in this whole domain
--     that started pre-scoped. Its SELECT policy had no workspace filter
--     (`using(true)`) and its write policy was `is_app_admin()`-gated
--     only, not workspace-gated -- both tightened here, the admin gate
--     preserved alongside the new workspace check, not replaced.
--
-- No RPC changes -- confirmed directly that no RPC writes to any table
-- in this migration's scope. `public_share_tokens`/`share_link_views`/
-- `share_link_actions` are written only by the already-hardened
-- share-link RPCs (migrations 138-140, 157, 158), which bypass RLS as
-- security definer and are unaffected by this migration's SELECT-only
-- changes.
--
-- Confirm 161 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- New owner-resolver helper functions. Same pattern as
-- every prior stage -- security definer, read the target table under
-- the OWNER's privileges, return NULL (never raise) for a dangling/
-- invalid id. `project_owner_workspace_id()` (migration 157) and
-- `purchase_order_owner_workspace_id()` (migration 160) already exist
-- and are reused directly, not recreated.
-- ============================================================

create or replace function public.purchase_request_owner_workspace_id(p_purchase_request_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.purchase_requests where id = p_purchase_request_id;
$$;

create or replace function public.project_shipment_owner_workspace_id(p_shipment_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select public.project_owner_workspace_id(project_id)
  from public.project_shipments
  where id = p_shipment_id;
$$;

-- project_documents has three nullable anchors and no single reliable
-- FK -- this resolver performs the identical three-way coalesce used
-- inline for project_documents' own policies below, but keyed by the
-- document's id, so sales_quote_extractions (which only has
-- project_document_id, not the anchor columns themselves) can reuse it
-- without duplicating the coalesce logic.
create or replace function public.project_document_owner_workspace_id(p_project_document_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    public.project_owner_workspace_id(pd.project_id),
    public.purchase_order_owner_workspace_id(pd.purchase_order_id),
    public.purchase_request_owner_workspace_id(pd.purchase_request_id)
  )
  from public.project_documents pd
  where pd.id = p_project_document_id;
$$;

revoke execute on function public.purchase_request_owner_workspace_id(uuid) from public;
revoke execute on function public.project_shipment_owner_workspace_id(uuid) from public;
revoke execute on function public.project_document_owner_workspace_id(uuid) from public;
grant execute on function public.purchase_request_owner_workspace_id(uuid) to authenticated;
grant execute on function public.project_shipment_owner_workspace_id(uuid) to authenticated;
grant execute on function public.project_document_owner_workspace_id(uuid) to authenticated;

-- ============================================================
-- Section 2 -- project_documents: three-way coalesce inline (project_id/
-- purchase_order_id/purchase_request_id are the row's own columns, no
-- need to call the id-based resolver against itself). No role gate.
-- ============================================================

drop policy if exists "authenticated read project_documents" on public.project_documents;
drop policy if exists "authenticated write project_documents" on public.project_documents;

create policy "workspace members read project_documents"
  on public.project_documents for select to authenticated
  using (public.is_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.purchase_request_owner_workspace_id(purchase_request_id)
  )));

create policy "workspace members insert project_documents"
  on public.project_documents for insert to authenticated
  with check (public.is_active_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.purchase_request_owner_workspace_id(purchase_request_id)
  )));

create policy "workspace members update project_documents"
  on public.project_documents for update to authenticated
  using (public.is_active_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.purchase_request_owner_workspace_id(purchase_request_id)
  )))
  with check (public.is_active_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.purchase_request_owner_workspace_id(purchase_request_id)
  )));

create policy "workspace members delete project_documents"
  on public.project_documents for delete to authenticated
  using (public.is_active_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.purchase_request_owner_workspace_id(purchase_request_id)
  )));

-- ============================================================
-- Section 3 -- sales_quote_extractions: child of project_documents, via
-- the id-based resolver. No role gate.
-- ============================================================

drop policy if exists "authenticated read sales_quote_extractions" on public.sales_quote_extractions;
drop policy if exists "authenticated write sales_quote_extractions" on public.sales_quote_extractions;

create policy "workspace members read sales_quote_extractions"
  on public.sales_quote_extractions for select to authenticated
  using (public.is_workspace_member(public.project_document_owner_workspace_id(project_document_id)));

create policy "workspace members insert sales_quote_extractions"
  on public.sales_quote_extractions for insert to authenticated
  with check (public.is_active_workspace_member(public.project_document_owner_workspace_id(project_document_id)));

create policy "workspace members update sales_quote_extractions"
  on public.sales_quote_extractions for update to authenticated
  using (public.is_active_workspace_member(public.project_document_owner_workspace_id(project_document_id)))
  with check (public.is_active_workspace_member(public.project_document_owner_workspace_id(project_document_id)));

create policy "workspace members delete sales_quote_extractions"
  on public.sales_quote_extractions for delete to authenticated
  using (public.is_active_workspace_member(public.project_document_owner_workspace_id(project_document_id)));

-- ============================================================
-- Section 4 -- project_shipping_addresses, project_shipments: clean
-- single anchor, project_owner_workspace_id() reused directly. No role
-- gate.
-- ============================================================

drop policy if exists "authenticated read project_shipping_addresses" on public.project_shipping_addresses;
drop policy if exists "authenticated write project_shipping_addresses" on public.project_shipping_addresses;

create policy "workspace members read project_shipping_addresses"
  on public.project_shipping_addresses for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_shipping_addresses"
  on public.project_shipping_addresses for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_shipping_addresses"
  on public.project_shipping_addresses for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_shipping_addresses"
  on public.project_shipping_addresses for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

drop policy if exists "authenticated read project_shipments" on public.project_shipments;
drop policy if exists "authenticated write project_shipments" on public.project_shipments;

create policy "workspace members read project_shipments"
  on public.project_shipments for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_shipments"
  on public.project_shipments for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_shipments"
  on public.project_shipments for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_shipments"
  on public.project_shipments for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

-- ============================================================
-- Section 5 -- project_shipment_lines, project_shipment_photos: children
-- of project_shipments, via project_shipment_owner_workspace_id(). No
-- role gate.
-- ============================================================

drop policy if exists "authenticated read project_shipment_lines" on public.project_shipment_lines;
drop policy if exists "authenticated write project_shipment_lines" on public.project_shipment_lines;

create policy "workspace members read project_shipment_lines"
  on public.project_shipment_lines for select to authenticated
  using (public.is_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members insert project_shipment_lines"
  on public.project_shipment_lines for insert to authenticated
  with check (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members update project_shipment_lines"
  on public.project_shipment_lines for update to authenticated
  using (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)))
  with check (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members delete project_shipment_lines"
  on public.project_shipment_lines for delete to authenticated
  using (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

drop policy if exists "authenticated read project_shipment_photos" on public.project_shipment_photos;
drop policy if exists "authenticated write project_shipment_photos" on public.project_shipment_photos;

create policy "workspace members read project_shipment_photos"
  on public.project_shipment_photos for select to authenticated
  using (public.is_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members insert project_shipment_photos"
  on public.project_shipment_photos for insert to authenticated
  with check (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members update project_shipment_photos"
  on public.project_shipment_photos for update to authenticated
  using (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)))
  with check (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

create policy "workspace members delete project_shipment_photos"
  on public.project_shipment_photos for delete to authenticated
  using (public.is_active_workspace_member(public.project_shipment_owner_workspace_id(shipment_id)));

-- ============================================================
-- Section 6 -- purchase_order_files storage bucket (storage.objects,
-- bucket id 'purchase-order-files'). Joins storage.objects.name against
-- the real purchase_order_files.storage_path row (exact match, not a
-- filename-prefix convention), then resolves workspace via
-- purchase_order_owner_workspace_id(). The purchase_order_files TABLE's
-- own RLS (migration 160) already governs which rows a caller can see in
-- that join -- but storage.objects policies run independently of
-- another table's RLS, so the workspace check is restated explicitly
-- here rather than relied upon implicitly.
-- ============================================================

drop policy if exists "authenticated read purchase-order-files objects" on storage.objects;
drop policy if exists "authenticated write purchase-order-files objects" on storage.objects;
drop policy if exists "authenticated update purchase-order-files objects" on storage.objects;
drop policy if exists "authenticated delete purchase-order-files objects" on storage.objects;

create policy "workspace members read purchase-order-files objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_order_files pof
      where pof.storage_path = storage.objects.name
        and public.is_workspace_member(public.purchase_order_owner_workspace_id(pof.purchase_order_id))
    )
  );

create policy "workspace members write purchase-order-files objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_order_files pof
      where pof.storage_path = storage.objects.name
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(pof.purchase_order_id))
    )
  );

create policy "workspace members update purchase-order-files objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_order_files pof
      where pof.storage_path = storage.objects.name
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(pof.purchase_order_id))
    )
  )
  with check (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_order_files pof
      where pof.storage_path = storage.objects.name
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(pof.purchase_order_id))
    )
  );

create policy "workspace members delete purchase-order-files objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_order_files pof
      where pof.storage_path = storage.objects.name
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(pof.purchase_order_id))
    )
  );

-- ============================================================
-- Section 7 -- public_share_tokens, share_link_views, share_link_actions:
-- SELECT-only tightening (all three are RPC-write-only since migrations
-- 137/144), reusing migration 158's share_link_entity_workspace_id()
-- directly. No new resolver, no write policy added (unchanged: RPC-only).
-- ============================================================

drop policy if exists "authenticated read public_share_tokens" on public.public_share_tokens;

create policy "workspace members read public_share_tokens"
  on public.public_share_tokens for select to authenticated
  using (public.is_workspace_member(public.share_link_entity_workspace_id(entity_type, entity_id)));

drop policy if exists "authenticated read share_link_views" on public.share_link_views;

create policy "workspace members read share_link_views"
  on public.share_link_views for select to authenticated
  using (public.is_workspace_member(public.share_link_entity_workspace_id(entity_type, entity_id)));

drop policy if exists "authenticated read share_link_actions" on public.share_link_actions;

create policy "workspace members read share_link_actions"
  on public.share_link_actions for select to authenticated
  using (public.is_workspace_member(public.share_link_entity_workspace_id(entity_type, entity_id)));

-- ============================================================
-- Section 8 -- workspace_share_link_settings: already has workspace_id
-- as its own PK. SELECT gains a workspace filter; write keeps its
-- existing is_app_admin() gate, ANDed with the new workspace check, not
-- replaced.
-- ============================================================

drop policy if exists "authenticated read workspace_share_link_settings" on public.workspace_share_link_settings;
drop policy if exists "admin write workspace_share_link_settings" on public.workspace_share_link_settings;

create policy "workspace members read workspace_share_link_settings"
  on public.workspace_share_link_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: admin write workspace_share_link_settings"
  on public.workspace_share_link_settings for all to authenticated
  using (public.is_active_workspace_member(workspace_id) and public.is_app_admin(auth.uid()))
  with check (public.is_active_workspace_member(workspace_id) and public.is_app_admin(auth.uid()));

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - Messaging channels and conversations/direct_messages -- blocked on
--     two open product decisions, tracked in
--     PRODUCT_MASTER_COMPLETION_PLAN.md §11's Stage 4 entry.
--   - notifications/notification_deliveries/push_subscriptions -- not a
--     workspace-containment gap (notifications is correctly
--     recipient-scoped; push_subscriptions is correctly user-scoped);
--     notification_deliveries' general openness is a real but unrelated
--     access-control bug, flagged separately.
--   - notification_rules -- likely Stage 5's job (global config, no
--     per-row tenant data), not touched either way.
--   - No RPC is touched -- confirmed none writes to any table in this
--     migration's scope besides the already-hardened share-link RPCs,
--     which bypass RLS as security definer.
-- ============================================================

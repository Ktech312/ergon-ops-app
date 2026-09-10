-- Migration 127: atomic, idempotent, workspace-safe Sales Quote -> Project
-- conversion.
--
-- Fixes a reliability bug found in the 2026-09-08 overnight error-visibility
-- audit (PRODUCT_ERROR_VISIBILITY_AUDIT.md's addendum, "createProjectFromClosedWonQuote
-- -- critical, partial multi-step write with no rollback"): the old client-side
-- implementation (persistence.ts's createProjectFromClosedWonQuote) made the
-- project row, its scope-of-work row, its BOM lines, each of its locations,
-- each location's hardware line items, and each location's photos as a long
-- sequence of separate PostgREST calls with no shared transaction, most of
-- them with their result silently discarded. A single network hiccup
-- partway through could leave a half-built project in production with the
-- success message identical whether everything copied over or almost
-- nothing did.
--
-- REVISION NOTE (second pass): this file replaces an earlier draft of
-- migration 127 that was reviewed before ever being run -- nothing in
-- either draft was ever applied to Supabase, so this remains a normal
-- pre-review revision, not a retroactive edit of an applied migration.
-- The first review found four gaps (fixed in the previous revision, see
-- HANDOFF.md): has_role()'s nested-search_path bug, missing workspace
-- ownership enforcement, an existing project misreported as complete, and
-- generic error messages. A second review of THAT revision found four more
-- gaps, all fixed in this one:
--   5. structure_verified was derived from projects.conversion_schema_version
--      -- a plain column on a table any PM/admin can already PATCH directly
--      (the ordinary "pm and admin write projects" RLS policy, migration
--      023), so nothing stopped someone from marking an incomplete legacy
--      project "verified" by hand, or clearing a real one. Replaced with a
--      new project_conversion_receipts table that has NO policies granting
--      any access to anon/authenticated at all -- with row level security
--      enabled and zero policies, Postgres denies every statement to every
--      role except the table owner, so only this function itself (running
--      as its security-definer owner) can ever write a row there.
--      structure_verified is now derived from that receipt's existence,
--      not from any column the ordinary Projects write path can reach.
--   6. resolve_caller_workspace_id() rejects a missing, suspended, or
--      ambiguous membership with a plain, uncoded exception (SQLSTATE
--      P0001, plpgsql's default) -- the frontend had no way to tell that
--      apart from a real network failure, so it fell into the same generic
--      "check your connection" bucket. Now caught and translated into its
--      own stable code (EC007) with a safe, specific message, without
--      modifying resolve_caller_workspace_id() itself.
--   7. cleanupOrphanedProjectLocationImage() (persistence.ts) claimed
--      cleanup failures were logged, but it called the existing
--      deleteStorageObject() helper, which swallows network errors and
--      never checks response.ok -- so the claim was false for almost every
--      real failure. Fixed with its own dedicated fetch that actually
--      inspects the response and logs status/body on failure, still never
--      throwing to the caller. deleteStorageObject() itself turned out to
--      already have zero real call sites anywhere in the codebase (dead
--      before this migration touched it) -- removed rather than kept
--      around unused.
--   8. A failed photo-row insert appended the raw PostgREST error message
--      (which can include a constraint or schema detail) directly into the
--      user-facing failure reason. That raw message is now only ever
--      logged to the console; the user sees a stable, plain message
--      ("...its photo record could not be saved. Try Create Project
--      again.").
--
-- This migration moves the project/scope-of-work/BOM-lines/locations/
-- location-items writes into ONE new security-definer function,
-- create_project_from_quote(quote_id), executed as the one implicit
-- transaction every PostgREST RPC call already runs in: either the whole
-- structure is created correctly, or (on any error) none of it is. The
-- function is also idempotent (a new unique index on
-- projects.source_sales_quote_id): calling it again for an
-- already-converted quote returns that project instead of duplicating it,
-- matching the existing "Create Project" button's retry-friendly UX
-- ("safe to click again if it didn't work the first time").
--
-- Photos are the one piece that can't move into that same SQL transaction
-- -- copying a storage object is an HTTP call to the Storage API, not
-- something a plpgsql function can wrap. So photo copying stays
-- client-side, called after this function has already committed the
-- project's full structure. Two changes make that safe instead of just
-- "not atomic": (1) the function always returns, for every location, the
-- set of source photo ids already copied over, so a retry after a partial
-- photo failure skips photos that already succeeded; (2) a new unique
-- index on project_location_images enforces that guarantee at the database
-- level too. The frontend half (persistence.ts) tracks every photo's copy
-- outcome individually, cleans up an orphaned Storage object if its
-- database row can't be saved, and treats a uniqueness conflict (a
-- concurrent retry that already won) as "already copied" rather than a
-- false failure -- see that file's own comment on
-- createProjectFromClosedWonQuote and src/project-conversion.test.ts.
--
-- Bundled fixes (free byproducts of rewriting the copy as INSERT ... SELECT
-- from the authoritative sales_quote_* tables instead of trusting whatever
-- the client happened to have loaded): every soft-deleted quote/location/
-- item/BOM-line (deleted_at is not null -- migration 088) is now correctly
-- excluded from copying; 'camera' and 'vpu' location items are now copied
-- (the old code only ever copied 'sign'/'sensor'/'misc', silently dropping
-- every camera and VPU line item since migrations 071/076 added those
-- types); each location item's location_label/accessory_catalog_item_id/
-- accessory_qty (migration 071) are now copied, previously always dropped;
-- each location's own address (migration 074) is now copied, previously
-- always dropped.
--
-- Deliberately out of scope for this migration, per E's explicit
-- instruction: any future Billing/down-payment approval gate on
-- conversion. This migration is only about making today's conversion
-- reliable and workspace-safe.
--
-- Also flagged, not fixed here (a separate, pre-existing authorization gap,
-- not a reliability/atomicity one -- fixing it would be scope creep on a
-- reliability fix): project_locations/project_location_items/
-- project_location_images still have the original wide-open
-- "authenticated write ... using(true)" policies from migration 064, never
-- narrowed to pm/admin the way projects/project_scope_of_work/
-- project_bom_lines were in migration 023. See HANDOFF.md's entry for this
-- migration for the full note.
--
-- Do not run this migration until E has reviewed the accompanying test
-- script (backend/supabase/migration_127_conversion_tests.sql) and this
-- file.

begin;

-- ============================================================
-- Section 0 -- Preflight: fail loudly and clearly, in-migration, if
-- production data is already incompatible with the unique index this
-- migration is about to create -- rather than a raw, unexplained Postgres
-- "could not create unique index ... is duplicated" error, or a separate
-- preflight script to run and interpret by hand first. If this raises, the
-- whole transaction aborts and nothing else in this migration runs.
--
-- The only realistic incompatibility: two or more existing projects
-- already sharing the same source_sales_quote_id. This can only be
-- true of *existing* data -- projects_source_sales_quote_id_key covers a
-- pre-existing column, so old, pre-127 conversions could theoretically
-- have left duplicates behind (e.g. a retried client-side conversion that
-- raced past its own check-then-act guard). The other new unique index
-- this migration adds (project_location_images_location_source_image_key)
-- cannot have this problem -- source_quote_image_id is a column this same
-- migration adds, so no existing row can already have a non-null value in
-- it, and the partial index only covers non-null values.
-- ============================================================

do $$
declare
  v_duplicate_count int;
  v_duplicate_quote_ids text;
begin
  select count(*), string_agg(source_sales_quote_id::text, ', ')
  into v_duplicate_count, v_duplicate_quote_ids
  from (
    select source_sales_quote_id
    from public.projects
    where source_sales_quote_id is not null
    group by source_sales_quote_id
    having count(*) > 1
  ) dup;

  if v_duplicate_count > 0 then
    raise exception 'Cannot apply migration 127: % Sales Quote(s) already have more than one linked Project (duplicate projects.source_sales_quote_id values): %. Inspect these specific quotes and their projects, decide which project is canonical for each quote, and either clear source_sales_quote_id on the other project(s) or merge/remove them -- this migration does not make that decision automatically. Nothing has been changed; re-run this migration after resolving them.', v_duplicate_count, v_duplicate_quote_ids;
  end if;
end $$;

-- ============================================================
-- Section 1 -- Idempotency and photo-retry-safety schema support.
-- ============================================================

-- One project per quote, enforced at the database level (not just by a
-- check-then-act read in application code, which has a race window between
-- the check and the insert). Partial index (only when not null) so plain
-- manually-created projects with no source quote are unaffected. The
-- preflight check above guarantees this CREATE will not fail on existing
-- duplicate data -- if it still somehow fails, that's a genuinely
-- unexpected condition worth investigating directly rather than one this
-- migration anticipated.
create unique index if not exists projects_source_sales_quote_id_key
  on public.projects(source_sales_quote_id)
  where source_sales_quote_id is not null;

-- Traces each copied photo back to the sales_quote_location_images row it
-- came from, mirroring the source_quote_location_id pattern project_locations
-- already uses (migration 064). Lets a retry after a partial photo failure
-- know which photos already copied successfully, instead of re-copying
-- (and duplicating) all of them.
alter table public.project_location_images
  add column if not exists source_quote_image_id uuid references public.sales_quote_location_images(id) on delete set null;

create unique index if not exists project_location_images_location_source_image_key
  on public.project_location_images(project_location_id, source_quote_image_id)
  where source_quote_image_id is not null;

-- ============================================================
-- Section 2 -- The tamper-resistant conversion receipt.
--
-- A row here means, unconditionally, "create_project_from_quote() itself
-- wrote this project's full structure, in one transaction." Deliberately
-- NOT a column on projects (or anywhere else an ordinary PM/admin write can
-- reach). Only the database owner and a trusted service-role connection
-- (the role migrations run as, and Supabase's own service_role) can read
-- or write this table -- an ordinary signed-in application user
-- (`authenticated`) or an anonymous request (`anon`) cannot, regardless of
-- PM/admin status inside the app's own role system. Two independent
-- layers enforce this: every table-level privilege on
-- anon/authenticated is explicitly revoked below (the primary mechanism --
-- Postgres checks table-level privileges before row security policies
-- ever run, so a revoked role's statement fails at the grant layer and
-- never reaches RLS at all), and row level security is also enabled with
-- ZERO policies as defense in depth, in case a privilege were ever
-- mistakenly re-granted later. Only this migration's own function, running
-- as a security-definer owned by the same role that creates it, can ever
-- write to this table. See migration_127_conversion_tests.sql (Section 4b)
-- for the tests proving an authenticated caller (even an admin) cannot
-- read, create, alter, or remove a receipt directly -- rejected at the
-- grant layer for all of SELECT/INSERT/UPDATE/DELETE, confirmed against
-- both has_table_privilege() and information_schema.role_table_grants.
-- ============================================================

create table if not exists public.project_conversion_receipts (
  project_id uuid primary key references public.projects(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.project_conversion_receipts enable row level security;
-- No policies added on purpose (see the comment above) -- this is
-- deliberate defense in depth, not a placeholder to fill in later. The
-- REVOKE below is the primary mechanism: it also strips any default-
-- privilege grant this project applies to new tables (the same "auto-
-- grant to anon/authenticated" trap migration 125 closed for functions
-- can apply to tables too).
revoke all on public.project_conversion_receipts from public, anon, authenticated;

-- ============================================================
-- Section 3 -- The atomic, idempotent, workspace-safe conversion function.
-- ============================================================

create or replace function public.create_project_from_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_quote record;
  v_project_id uuid;
  v_already_existed boolean := false;
  v_structure_verified boolean;
  v_garage_count int;
  v_lot_count int;
  v_camera_count int;
  v_site_type text;
  v_address text;
  v_billing_address text;
  v_bom_line_count int := 0;
  v_location_count int := 0;
  v_location_item_count int := 0;
  v_locations_json jsonb;
  v_constraint_name text;
begin
  -- resolve_caller_workspace_id() (migration 117) is itself hardened
  -- (`set search_path=''`, every reference fully qualified), so it's safe
  -- to call from in here -- unlike has_role(), which is NOT hardened and
  -- is deliberately NOT called from this function (see the file header).
  -- It raises its own clear exception (SQLSTATE P0001, no custom code) if
  -- the caller has no active workspace membership, a suspended one, or
  -- more than one -- there is no admin bypass for this resolution step: an
  -- admin must belong to a real, active workspace to convert a quote in
  -- it, same as a PM. Caught and translated here into one stable code so
  -- the frontend can show a safe, specific message instead of lumping it
  -- in with a real network failure.
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  if not (
    public.is_app_admin(auth.uid())
    or exists (
      select 1
      from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = auth.uid()
        and wm.workspace_id = v_caller_workspace_id
        and wmr.role_key = 'pm'
    )
  ) then
    raise exception 'Only a PM or admin may convert a Sales Quote into a Project.' using errcode = 'EC001';
  end if;

  select * into v_quote from public.sales_quotes where id = p_quote_id and deleted_at is null;
  if not found then
    raise exception 'This Sales Quote could not be found -- it may have been deleted.' using errcode = 'EC003';
  end if;

  if v_quote.workspace_id is distinct from v_caller_workspace_id then
    raise exception 'This Sales Quote belongs to a different workspace and cannot be converted from here.' using errcode = 'EC002';
  end if;

  if v_quote.status is distinct from 'closed_won' then
    raise exception 'Sales Quote "%" is not Closed - Won yet -- set its status first, then try again.', v_quote.site_name using errcode = 'EC004';
  end if;

  select id into v_project_id from public.projects where source_sales_quote_id = p_quote_id;

  if v_project_id is null then
    select
      count(*) filter (where location_type = 'garage'),
      count(*) filter (where location_type = 'lot'),
      coalesce(sum(fli::int) + sum(lpr::int) + sum(people_counting::int), 0)
    into v_garage_count, v_lot_count, v_camera_count
    from public.sales_quote_locations
    where quote_id = p_quote_id and deleted_at is null;

    v_site_type := case
      when v_garage_count > 0 and v_lot_count > 0 then 'Mixed Parking'
      when v_lot_count > 0 then 'Surface Lot'
      else 'Parking Garage'
    end;

    -- concat_ws skips NULL arguments, which is exactly the JS
    -- `.filter(Boolean).join(", ")` behavior the old client-side code used --
    -- nullif() turns each blank string into NULL first so a blank field
    -- doesn't leave a stray ", " in the result.
    v_address := nullif(concat_ws(', ',
      nullif(v_quote.site_street_address, ''), nullif(v_quote.city, ''),
      nullif(v_quote.site_state, ''), nullif(v_quote.site_zip, '')), '');
    v_billing_address := nullif(concat_ws(', ',
      nullif(v_quote.client_street_address, ''), nullif(v_quote.client_city, ''),
      nullif(v_quote.client_state, ''), nullif(v_quote.client_zip, '')), '');

    begin
      insert into public.projects (
        project_name, customer_name, site_type, site_address, app_status, camera_count, notes,
        source_sales_quote_id, converted_from_quote_at, saas_type, saas_contract_amount,
        saas_billing_frequency, sale_amount, client_office_phone, billing_name, billing_address
      ) values (
        v_quote.site_name, nullif(v_quote.client_name, ''), v_site_type, v_address, 'Draft', v_camera_count,
        'Created from Closed - Won Sales Quote "' || v_quote.site_name || '".',
        p_quote_id, now(), nullif(v_quote.saas_type, ''), v_quote.saas_contract_amount,
        nullif(v_quote.saas_billing_frequency, ''), v_quote.sale_amount, nullif(v_quote.contact_phone, ''),
        nullif(v_quote.client_name, ''), v_billing_address
      )
      returning id into v_project_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'projects_source_sales_quote_id_key' then
        -- Lost a race against a concurrent conversion of the same quote --
        -- nothing of ours was written (the whole insert failed), so it's
        -- safe to just ask the caller to retry rather than guess at the
        -- other transaction's uncommitted state.
        raise exception 'This quote is already being converted by someone else -- please try again in a moment.' using errcode = 'EC006';
      end if;
      raise exception 'A project named "%" already exists and is not linked to this quote -- rename the project or the quote''s site name before converting.', v_quote.site_name using errcode = 'EC005';
    end;

    insert into public.project_scope_of_work (project_id) values (v_project_id);

    insert into public.project_bom_lines (project_id, item_name, qty, notes, line_sort)
    select v_project_id, bl.item_name, bl.qty,
      coalesce(nullif(bl.notes, ''), 'Copied from closed-won quote "' || v_quote.site_name || '".'),
      bl.line_sort
    from public.sales_quote_bom_lines bl
    where bl.quote_id = p_quote_id and bl.deleted_at is null;
    get diagnostics v_bom_line_count = row_count;

    insert into public.project_locations (
      project_id, location_type, name, line_sort, fli, lpr, people_counting,
      fli_camera_item_id, lpr_camera_item_id, people_counting_camera_item_id,
      entries_count, exits_count, levels_count, address, source_quote_location_id
    )
    select
      v_project_id, ql.location_type, ql.name, ql.line_sort, ql.fli, ql.lpr, ql.people_counting,
      ql.fli_camera_item_id, ql.lpr_camera_item_id, ql.people_counting_camera_item_id,
      ql.entries_count, ql.exits_count, ql.levels_count, ql.address, ql.id
    from public.sales_quote_locations ql
    where ql.quote_id = p_quote_id and ql.deleted_at is null;
    get diagnostics v_location_count = row_count;

    -- Every line type (sign/sensor/misc/camera/vpu -- migrations 056/071/076),
    -- not just the three the old client-side code copied.
    insert into public.project_location_items (
      project_location_id, line_type, catalog_item_id, qty, line_sort,
      location_label, accessory_catalog_item_id, accessory_qty
    )
    select
      pl.id, qli.line_type, qli.catalog_item_id, qli.qty, qli.line_sort,
      qli.location_label, qli.accessory_catalog_item_id, qli.accessory_qty
    from public.sales_quote_location_items qli
    join public.sales_quote_locations ql on ql.id = qli.quote_location_id
    join public.project_locations pl on pl.source_quote_location_id = ql.id and pl.project_id = v_project_id
    where ql.quote_id = p_quote_id and ql.deleted_at is null and qli.deleted_at is null;
    get diagnostics v_location_item_count = row_count;

    -- The receipt -- written in this same transaction as everything above,
    -- so its existence is a real guarantee that this specific call built
    -- the whole structure, not a flag anything else can set.
    insert into public.project_conversion_receipts (project_id) values (v_project_id);
  else
    v_already_existed := true;
    select count(*) into v_bom_line_count from public.project_bom_lines where project_id = v_project_id;
    select count(*) into v_location_count from public.project_locations where project_id = v_project_id and deleted_at is null;
    select count(*) into v_location_item_count
      from public.project_location_items pli
      join public.project_locations pl on pl.id = pli.project_location_id
      where pl.project_id = v_project_id and pl.deleted_at is null;
  end if;

  select exists(
    select 1 from public.project_conversion_receipts where project_id = v_project_id
  ) into v_structure_verified;

  -- Computed unconditionally (fresh creation or idempotent short-circuit
  -- alike) -- the caller always needs this mapping to know where to copy
  -- each location's photos, and which of them are already done.
  select jsonb_agg(jsonb_build_object(
    'quote_location_id', pl.source_quote_location_id,
    'project_location_id', pl.id,
    'already_copied_quote_image_ids', coalesce((
      select jsonb_agg(pli.source_quote_image_id)
      from public.project_location_images pli
      where pli.project_location_id = pl.id and pli.source_quote_image_id is not null
    ), '[]'::jsonb)
  ))
  into v_locations_json
  from public.project_locations pl
  where pl.project_id = v_project_id and pl.deleted_at is null;

  return jsonb_build_object(
    'project_id', v_project_id,
    'already_existed', v_already_existed,
    -- true only when a row exists in project_conversion_receipts for this
    -- project -- a table only this function can ever write to. Never
    -- inferred from row counts or from any column an ordinary Projects
    -- write can reach. A project converted by the pre-127 code, or made by
    -- hand, always comes back false here even if it happens to look
    -- complete.
    'structure_verified', v_structure_verified,
    'bom_line_count', v_bom_line_count,
    'location_count', v_location_count,
    'location_item_count', v_location_item_count,
    'locations', coalesce(v_locations_json, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_project_from_quote(uuid) from public;
revoke execute on function public.create_project_from_quote(uuid) from anon;
grant execute on function public.create_project_from_quote(uuid) to authenticated;

commit;

-- Migration 131: atomic, per-project-safe Project BOM replacement.
--
-- Fixes the reliability gap documented in
-- PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md: saveProjectSites
-- (src/persistence.ts) replaces a project's BOM line set with two separate,
-- completely unchecked PostgREST requests -- a bulk DELETE of every
-- existing line for the project, then a bulk INSERT of the current line
-- set -- with no transaction between them and no id preservation across a
-- save. If the DELETE succeeds and the INSERT then fails (or silently
-- drops rows, since it uses `prefer: return=minimal`), the project's BOM
-- is left genuinely empty, not just unverified -- and every retained line
-- gets a brand-new id on every save regardless, which would silently
-- orphan any real task_hardware_dependencies.project_bom_line_id reference
-- to it (ON DELETE SET NULL, migration 029).
--
-- DRAFTED FOR LOCAL REVIEW ONLY. NOT RUN. Do not apply this migration
-- until E has reviewed it and the accompanying test script
-- (backend/supabase/migration_131_bom_replace_tests.sql), and do not
-- deploy the frontend wiring that calls this RPC before it exists in
-- production -- see HANDOFF.md's entry for this pass.
--
-- Decisions this migration implements, carried over unchanged from
-- PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md and confirmed again in the
-- work order this migration was written under:
--   - One project per RPC call (replace_project_bom_lines(project_id,
--     lines)); the whole-batch-across-multiple-projects question the plan
--     document left open is out of scope -- this function only ever
--     touches the one project it's given.
--   - Reconcile-by-id, not delete-then-reinsert: a supplied line with a
--     non-null id that belongs to this project is updated IN PLACE (same
--     row, same id); a supplied line with no id is inserted as new; an
--     existing line whose id is not present anywhere in the payload is
--     deleted. This is what actually closes the task_hardware_dependencies
--     orphaning risk above -- a retained line's id never changes.
--   - A supplied line id that does not belong to this project (wrong
--     project, or doesn't exist at all) is a hard rejection of the WHOLE
--     call, nothing is written. Never silently reassigned or treated as
--     "insert new."
--   - Every client-supplied inventory_item_id/sku is untrusted input and
--     is verified against inventory_items before being trusted -- an
--     inventory_item_id that doesn't exist, a sku that doesn't exist, or
--     an inventory_item_id+sku pair that name two different rows are all
--     hard rejections.
--   - An item_name used as a fallback (only when a line supplies neither a
--     stable inventory_item_id nor a sku) that matches more than one
--     inventory_items row rejects the WHOLE call before anything is
--     written -- never an arbitrary pick. This matches the same policy
--     migration 130 already uses for equipment-recipe components.
--   - An item_name fallback that matches ZERO rows is tolerated (resolves
--     to a null inventory_item_id), matching saveProjectSites' own
--     existing, current behavior today and the still-open, NOT YET
--     implemented "warn on unresolved optional association" product
--     decision (see this pass's HANDOFF.md entry) -- this migration does
--     not change that behavior, only how ambiguous/invalid identifiers are
--     handled, which is a different case (multiple matches or a bad
--     stable id, not zero matches on a display name).
--   - The parent projects row is locked with FOR UPDATE before any
--     reconciliation, exactly as PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md
--     §4 requires -- this is what actually serializes two concurrent
--     replace calls for the SAME project; two DIFFERENT projects never
--     contend, since the lock is per-row.
--   - Returns the complete saved BOM line collection for the project,
--     including every generated id, in the frontend's own BomLine shape --
--     not just counts -- so the caller's next save is automatically
--     correct without a second network round trip (same reasoning as
--     migration 130's own return shape).
--
-- Deviations from PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md's own
-- illustrative outline, found and corrected during this migration's own
-- live-schema verification (the plan document explicitly flags its SQL as
-- "not runnable, must be re-verified against the live schema" -- these are
-- exactly the re-verification findings):
--   1. `projects` has NO `deleted_at` column (confirmed: no migration ever
--      adds one -- migration 088's soft-delete pass covers sales_quotes,
--      project_locations/items/images, project_shipment_photos, and
--      several other tables, but never `projects` itself). The plan's
--      illustrative `where id = p_project_id and deleted_at is null for
--      update` would fail outright against the real schema. This
--      migration locks and looks up the project by id alone.
--   2. Authorization uses `public.is_workspace_admin(v_caller_workspace_id)`
--      (migration 115), not `is_app_admin(auth.uid())` (the legacy GLOBAL
--      admin system migration 127's create_project_from_quote still uses).
--      This is a deliberate consistency choice with migration 130's own,
--      later, reviewed correction (that migration's second draft replaced
--      exactly this same is_app_admin() call with
--      is_workspace_admin(workspace_id) after review found it was the
--      wrong gate for a workspace-scoped decision) -- not a re-litigation
--      of migration 127 itself, which this migration does not touch.
--      "PM" is still checked via the same workspace_member_roles join
--      migration 127/130 both already use, unchanged.
--   3. EC0xx codes re-verified immediately before drafting this file:
--      `grep -rhoE "errcode = '[A-Z0-9]+'" backend/supabase/migrations/*.sql`
--      returns exactly EC001-EC016 (EC001-EC007 in migration 127,
--      EC008-EC016 in migration 130) -- EC017 is genuinely the next free
--      code, confirming PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md's own
--      note. This migration claims EC017-EC024 (EC007 itself is REUSED,
--      not reclaimed, for the same "workspace resolution ambiguous" case
--      migrations 127/130 already use it for). EC025 is the next free
--      code for any future RPC -- re-verify again at that time.
--   4. Structural validation (malformed line data, invalid enum values)
--      uses ONE shared error code (EC020) covering every sub-case, matching
--      migration 130's own established precedent (that migration's EC011
--      covers several distinct structural-validation failures, not one
--      code per sub-case) -- the plan document had explicitly left
--      "one code per case, or one shared code" as an open implementation
--      decision; this migration follows 130's own precedent for
--      consistency.
--   5. `status`/`request_speed`/`procurement_track` are validated against
--      their real check-constraint value lists (confirmed directly against
--      migrations 022/047) before any write is attempted, per the plan's
--      §3 step 4a addition, rather than left to surface as a raw
--      constraint-violation error partway through the reconcile step.
--
-- Precedent: same shape as migrations 127/130 -- one security-definer
-- function, `set search_path = ''`, every table reference schema-
-- qualified, resolve_caller_workspace_id() for caller workspace
-- resolution (never the unhardened has_role()), stable EC0xx codes,
-- FOR UPDATE concurrency safety. Parsing/validation uses plain PL/pgSQL
-- arrays and FOR loops, not a temporary table or jsonb_to_recordset --
-- same reasoning as migration 130 (a hot, frequently-invoked function;
-- CREATE TEMPORARY TABLE inside it is a known rough edge; a project's BOM
-- realistically has at most a few dozen lines, so the O(n^2) duplicate/
-- identity checks below are negligible in practice).
--
-- Schema facts this migration relies on (re-verified directly against
-- backend/supabase/migrations/001_initial_ops_schema.sql,
-- 011/032/047/079 (project_bom_lines' later columns), 022_phase10_
-- projects_cutover.sql, 029_phase21_task_hardware_dependencies.sql,
-- 115_workspaces_foundation.sql, not assumed):
--   - project_bom_lines(id uuid pk, project_id uuid not null references
--     projects(id) on delete cascade, item_name text not null,
--     inventory_item_id uuid references inventory_items(id) [nullable],
--     qty numeric(12,2) not null, status text not null check(...),
--     request_speed text not null check(...), po text, notes text,
--     line_sort integer not null, procurement_track text not null default
--     'warehouse_stock' check(...), purchasing_sent_at timestamptz,
--     ship_to text). No unique constraint on item_name (unlike
--     equipment_types/equipment_bom_components) -- item_name is NEVER a
--     natural key here, only a display snapshot; inventory_item_id is the
--     only real link to the catalog.
--   - inventory_items.sku is NOT NULL and has a real UNIQUE constraint
--     (migration 001) -- a sku matching more than one row is a genuine
--     schema-integrity anomaly, not a reachable input-validation case;
--     still checked defensively (treated the same as "not found"), never
--     assumed impossible.
--   - task_hardware_dependencies.project_bom_line_id references
--     project_bom_lines(id) on delete set null (migration 029) --
--     confirmed still zero real rows populate this column today
--     (addTaskHardwareDependency, persistence.ts, always passes
--     projectBomLineId: null from its one call site) -- this migration's
--     id-preservation guarantee closes the risk going forward regardless.
--   - public.is_workspace_admin(check_workspace_id uuid) (migration 115),
--     public.resolve_caller_workspace_id() (migration 117), and
--     public.active_workspace_id() (migration 124) are the same already-
--     hardened, already-`authenticated`-granted helpers migration 130
--     uses -- not new joins invented here.
--   - The existing RLS policy on project_bom_lines ("pm and admin write
--     project_bom_lines", migration 023, using the legacy
--     is_app_admin()/has_role('pm') pattern) is NOT touched by this
--     migration -- this function's own internal authorization check is
--     separate from, and in addition to, that policy (a security-definer
--     function bypasses RLS on the tables it touches; this migration does
--     not change who may write to project_bom_lines through any OTHER
--     path). No existing access policy is changed by this file.
--
-- Do not run this migration until E has reviewed the accompanying test
-- script (backend/supabase/migration_131_bom_replace_tests.sql) and this
-- file.

begin;

-- ============================================================
-- Section 1 -- the atomic, per-project-safe BOM replace function.
-- ============================================================

create or replace function public.replace_project_bom_lines(
  p_project_id uuid,   -- required: the project whose BOM is being replaced
  p_lines jsonb         -- required: explicit JSON array (may be empty --
                         -- an empty array deliberately clears every
                         -- existing line for this project, same as
                         -- saveProjectSites' current behavior)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_project_id uuid;
  v_line_count int;
  v_i int;
  v_j int;

  -- Parsing/validation working arrays, index-aligned with each other and
  -- with the incoming p_lines array order.
  v_raw_elem record;
  v_ids uuid[] := array[]::uuid[];
  v_item_names text[] := array[]::text[];
  v_skus text[] := array[]::text[];
  v_inventory_item_ids uuid[] := array[]::uuid[];
  v_qtys numeric[] := array[]::numeric[];
  v_statuses text[] := array[]::text[];
  v_request_speeds text[] := array[]::text[];
  v_pos text[] := array[]::text[];
  v_notes_arr text[] := array[]::text[];
  v_procurement_tracks text[] := array[]::text[];
  v_ship_tos text[] := array[]::text[];
  v_purchasing_sent_ats timestamptz[] := array[]::timestamptz[];
  v_line_sorts int[] := array[]::int[];

  v_parsed_id uuid;
  v_parsed_item_name text;
  v_parsed_sku text;
  v_parsed_inventory_item_id uuid;
  v_parsed_qty numeric;
  v_parsed_status text;
  v_parsed_request_speed text;
  v_parsed_po text;
  v_parsed_notes text;
  v_parsed_procurement_track text;
  v_parsed_ship_to text;
  v_parsed_purchasing_sent_at timestamptz;
  v_parsed_sort int;

  v_duplicate_ids uuid[] := array[]::uuid[];
  v_unknown_ids uuid[] := array[]::uuid[];
  v_invalid_identity_lines text[] := array[]::text[];
  v_mismatched_lines text[] := array[]::text[];
  v_ambiguous_names text[] := array[]::text[];
  v_resolved_inventory_item_ids uuid[] := array[]::uuid[];
  v_sku_check_id uuid;
  v_name_match_ids uuid[];
  v_name_match_count int;

  v_updated_count int := 0;
  v_inserted_count int := 0;
  v_deleted_count int := 0;
  v_result_json jsonb;
begin
  -- --------------------------------------------------------
  -- Step 1: fail closed on the temporary single-workspace assumption.
  -- Same guard, same reasoning, as migration 130's Step 1.
  -- --------------------------------------------------------
  begin
    perform public.active_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'This action is not available right now. Contact an administrator.' using errcode = 'EC017';
  end;

  -- --------------------------------------------------------
  -- Step 2: resolve the caller's workspace, then check role. See this
  -- file's header for why is_workspace_admin() is used here rather than
  -- is_app_admin() -- a deliberate consistency choice with migration 130's
  -- own reviewed correction, not a change to migration 127 itself.
  -- --------------------------------------------------------
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  if not (
    public.is_workspace_admin(v_caller_workspace_id)
    or exists (
      select 1
      from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = auth.uid()
        and wm.workspace_id = v_caller_workspace_id
        and wmr.role_key = 'pm'
    )
  ) then
    raise exception 'Only a PM or workspace administrator may replace a project''s BOM.' using errcode = 'EC018';
  end if;

  -- --------------------------------------------------------
  -- Step 3: load and lock the parent project row. FOR UPDATE here (not an
  -- advisory lock) is what serializes two concurrent replace calls for the
  -- SAME project -- a second call for this exact project_id blocks until
  -- the first call's transaction commits or rolls back. Two calls for
  -- DIFFERENT projects never contend (the lock is per-row, not table-
  -- wide). projects has no deleted_at column (see this file's header) --
  -- a plain existence check is all that's needed or possible here.
  -- --------------------------------------------------------
  select id into v_project_id from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'This project could not be found -- it may have been deleted.' using errcode = 'EC019';
  end if;

  -- --------------------------------------------------------
  -- Step 4: structural validation, before any resolution or write.
  -- p_lines must be a real, explicit JSON array -- SQL NULL, JSON null, an
  -- object, a string, a number, or a boolean are all rejected here (same
  -- reasoning as migration 130's p_components check: an accidental
  -- omission must never be silently treated as "clear everything," even
  -- though an explicit empty array is a real, deliberate "clear
  -- everything" instruction and is accepted below).
  -- --------------------------------------------------------
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'This project''s BOM line list must be an explicit list, not missing, null, or a single value/object.' using errcode = 'EC020';
  end if;

  -- Each element is parsed in its own nested exception block so a single
  -- malformed entry (wrong JSON type, unparseable uuid/number) is reported
  -- as one controlled rejection, not a raw cast error -- same technique as
  -- migration 130's component-parsing loop.
  for v_raw_elem in
    select ord, elem from jsonb_array_elements(p_lines) with ordinality as t(elem, ord)
  loop
    begin
      v_parsed_id := nullif(v_raw_elem.elem->>'id', '')::uuid;
      v_parsed_item_name := nullif(trim(v_raw_elem.elem->>'item_name'), '');
      v_parsed_sku := nullif(trim(v_raw_elem.elem->>'sku'), '');
      v_parsed_inventory_item_id := nullif(v_raw_elem.elem->>'inventory_item_id', '')::uuid;
      v_parsed_qty := (v_raw_elem.elem->>'qty')::numeric;
      v_parsed_status := v_raw_elem.elem->>'status';
      v_parsed_request_speed := v_raw_elem.elem->>'request_speed';
      v_parsed_po := nullif(v_raw_elem.elem->>'po', '');
      v_parsed_notes := nullif(v_raw_elem.elem->>'notes', '');
      v_parsed_procurement_track := coalesce(nullif(v_raw_elem.elem->>'procurement_track', ''), 'warehouse_stock');
      v_parsed_ship_to := nullif(v_raw_elem.elem->>'ship_to', '');
      v_parsed_purchasing_sent_at := nullif(v_raw_elem.elem->>'purchasing_sent_at', '')::timestamptz;
      v_parsed_sort := coalesce((v_raw_elem.elem->>'line_sort')::int, (v_raw_elem.ord - 1)::int);
    exception when others then
      raise exception 'This project''s BOM line list is malformed and could not be read.' using errcode = 'EC020';
    end;

    if v_parsed_item_name is null then
      raise exception 'Every BOM line needs an item name.' using errcode = 'EC020';
    end if;
    -- Same NaN/Infinity/overflow-safe quantity check as migration 130 --
    -- a plain `&gt; 0` comparison alone does not reject NaN or Infinity
    -- (Postgres numeric NaN sorts larger than any real number).
    if v_parsed_qty is null or v_parsed_qty <= 0 then
      raise exception 'Every BOM line must have a quantity greater than zero.' using errcode = 'EC020';
    end if;
    if v_parsed_qty::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Every BOM line must have a valid, finite quantity.' using errcode = 'EC020';
    end if;
    if v_parsed_qty >= 10000000000 then
      raise exception 'A BOM line''s quantity is too large to be saved.' using errcode = 'EC020';
    end if;
    if v_parsed_status is null or v_parsed_status not in ('Need Quote', 'Not started', 'Ordered', 'Completed', 'From Inventory', 'Delivered to Office', 'Delivered to Client') then
      raise exception 'A BOM line has an invalid status value.' using errcode = 'EC020';
    end if;
    if v_parsed_request_speed is null or v_parsed_request_speed not in ('ASAP', 'Standard', 'Future') then
      raise exception 'A BOM line has an invalid request-speed value.' using errcode = 'EC020';
    end if;
    if v_parsed_procurement_track not in ('pull', 'warehouse_stock', 'direct_to_project') then
      raise exception 'A BOM line has an invalid procurement-track value.' using errcode = 'EC020';
    end if;

    v_ids := array_append(v_ids, v_parsed_id);
    v_item_names := array_append(v_item_names, v_parsed_item_name);
    v_skus := array_append(v_skus, v_parsed_sku);
    v_inventory_item_ids := array_append(v_inventory_item_ids, v_parsed_inventory_item_id);
    v_qtys := array_append(v_qtys, v_parsed_qty);
    v_statuses := array_append(v_statuses, v_parsed_status);
    v_request_speeds := array_append(v_request_speeds, v_parsed_request_speed);
    v_pos := array_append(v_pos, v_parsed_po);
    v_notes_arr := array_append(v_notes_arr, v_parsed_notes);
    v_procurement_tracks := array_append(v_procurement_tracks, v_parsed_procurement_track);
    v_ship_tos := array_append(v_ship_tos, v_parsed_ship_to);
    v_purchasing_sent_ats := array_append(v_purchasing_sent_ats, v_parsed_purchasing_sent_at);
    v_line_sorts := array_append(v_line_sorts, v_parsed_sort);
  end loop;

  v_line_count := coalesce(array_length(v_ids, 1), 0);

  -- Duplicate non-null supplied ids: two lines in the same payload
  -- referencing the same existing row would otherwise both try to UPDATE
  -- the same row below, and it's ambiguous which values should win.
  -- O(n^2), negligible for a realistic BOM size.
  for v_i in 1 .. v_line_count loop
    if v_ids[v_i] is not null then
      for v_j in (v_i + 1) .. v_line_count loop
        if v_ids[v_j] = v_ids[v_i] then
          v_duplicate_ids := array_append(v_duplicate_ids, v_ids[v_i]);
        end if;
      end loop;
    end if;
  end loop;
  if array_length(v_duplicate_ids, 1) > 0 then
    raise exception 'This BOM could not be saved -- these line ids appear more than once in the same save: %.', array_to_string(v_duplicate_ids, ', ') using errcode = 'EC021';
  end if;

  -- A supplied id that does not belong to THIS project (wrong project, or
  -- doesn't exist at all) is always a hard rejection -- never treated as
  -- "insert as new" and never silently reassigned to a different row.
  for v_i in 1 .. v_line_count loop
    if v_ids[v_i] is not null and not exists (
      select 1 from public.project_bom_lines where id = v_ids[v_i] and project_id = p_project_id
    ) then
      v_unknown_ids := array_append(v_unknown_ids, v_ids[v_i]);
    end if;
  end loop;
  if array_length(v_unknown_ids, 1) > 0 then
    raise exception 'This BOM could not be saved -- these line ids do not belong to this project or no longer exist: %.', array_to_string(v_unknown_ids, ', ') using errcode = 'EC022';
  end if;

  -- --------------------------------------------------------
  -- Step 5/6: item identity resolution. A client-supplied STABLE
  -- identifier (inventory_item_id and/or sku) is untrusted input and is
  -- verified -- an invalid or mismatched stable identifier is a hard
  -- rejection, unlike the name-fallback path below. Only a line with
  -- NEITHER a stable identifier falls back to resolving item_name, and
  -- only an AMBIGUOUS (more than one match) name rejects the whole call --
  -- a name matching zero rows is tolerated (inventory_item_id stays null),
  -- matching saveProjectSites' current, unchanged behavior (see this
  -- file's header).
  -- --------------------------------------------------------
  for v_i in 1 .. v_line_count loop
    if v_inventory_item_ids[v_i] is not null then
      if not exists (select 1 from public.inventory_items where id = v_inventory_item_ids[v_i]) then
        v_invalid_identity_lines := array_append(v_invalid_identity_lines, v_item_names[v_i]);
      else
        v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, v_inventory_item_ids[v_i]);
        if v_skus[v_i] is not null then
          select id into v_sku_check_id from public.inventory_items where sku = v_skus[v_i];
          if v_sku_check_id is distinct from v_inventory_item_ids[v_i] then
            v_mismatched_lines := array_append(v_mismatched_lines, v_item_names[v_i]);
          end if;
        end if;
        continue;
      end if;
    elsif v_skus[v_i] is not null then
      select id into v_sku_check_id from public.inventory_items where sku = v_skus[v_i];
      if v_sku_check_id is null then
        v_invalid_identity_lines := array_append(v_invalid_identity_lines, v_item_names[v_i]);
      else
        v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, v_sku_check_id);
        continue;
      end if;
    else
      select array_agg(id) into v_name_match_ids from public.inventory_items where item_name = v_item_names[v_i];
      v_name_match_count := coalesce(array_length(v_name_match_ids, 1), 0);
      if v_name_match_count = 1 then
        v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, v_name_match_ids[1]);
        continue;
      elsif v_name_match_count > 1 then
        v_ambiguous_names := array_append(v_ambiguous_names, v_item_names[v_i]);
      end if;
      -- Zero matches: tolerated, falls through to append null below.
    end if;
    v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, null);
  end loop;

  if array_length(v_invalid_identity_lines, 1) > 0 then
    raise exception 'This BOM could not be saved -- these lines reference a catalog item that could not be found: %.', array_to_string(v_invalid_identity_lines, ', ') using errcode = 'EC023';
  end if;
  if array_length(v_mismatched_lines, 1) > 0 then
    raise exception 'This BOM could not be saved -- these lines'' supplied item id and sku do not refer to the same catalog item: %.', array_to_string(v_mismatched_lines, ', ') using errcode = 'EC023';
  end if;
  if array_length(v_ambiguous_names, 1) > 0 then
    raise exception 'This BOM could not be saved -- these item names match more than one catalog item: %.', array_to_string(v_ambiguous_names, ', ') using errcode = 'EC024';
  end if;

  -- --------------------------------------------------------
  -- Step 7: reconcile. Update retained lines in place (same row, same
  -- id), insert genuinely new lines, delete only the lines whose id is no
  -- longer present in the payload -- never a blanket delete-first. An
  -- empty p_lines deliberately clears every existing line for this
  -- project (a real "BOM now has zero lines" case, not an error).
  -- --------------------------------------------------------
  for v_i in 1 .. v_line_count loop
    if v_ids[v_i] is not null then
      update public.project_bom_lines set
        item_name = v_item_names[v_i],
        inventory_item_id = v_resolved_inventory_item_ids[v_i],
        qty = v_qtys[v_i],
        status = v_statuses[v_i],
        request_speed = v_request_speeds[v_i],
        po = v_pos[v_i],
        notes = v_notes_arr[v_i],
        line_sort = v_line_sorts[v_i],
        procurement_track = v_procurement_tracks[v_i],
        purchasing_sent_at = v_purchasing_sent_ats[v_i],
        ship_to = v_ship_tos[v_i],
        updated_at = now()
      where id = v_ids[v_i] and project_id = p_project_id;
      v_updated_count := v_updated_count + 1;
    end if;
  end loop;

  for v_i in 1 .. v_line_count loop
    if v_ids[v_i] is null then
      insert into public.project_bom_lines (
        project_id, item_name, inventory_item_id, qty, status, request_speed,
        po, notes, line_sort, procurement_track, purchasing_sent_at, ship_to
      ) values (
        p_project_id, v_item_names[v_i], v_resolved_inventory_item_ids[v_i], v_qtys[v_i], v_statuses[v_i], v_request_speeds[v_i],
        v_pos[v_i], v_notes_arr[v_i], v_line_sorts[v_i], v_procurement_tracks[v_i], v_purchasing_sent_ats[v_i], v_ship_tos[v_i]
      );
      v_inserted_count := v_inserted_count + 1;
    end if;
  end loop;

  delete from public.project_bom_lines
  where project_id = p_project_id
    and id <> all(coalesce(array_remove(v_ids, null), array[]::uuid[]));
  get diagnostics v_deleted_count = row_count;

  -- --------------------------------------------------------
  -- Step 8: return the full saved BOM line collection, including every
  -- generated id, in BomLine's own frontend shape (camelCase) -- not just
  -- counts -- so the caller's next save is automatically correct without
  -- a second network round trip. sku is looked up live via the current
  -- inventory_item_id link (project_bom_lines has no sku column of its
  -- own); item_name is returned exactly as stored (a display snapshot,
  -- never overwritten from the catalog's current name).
  -- --------------------------------------------------------
  select jsonb_build_object(
    'projectId', p_project_id,
    'updatedCount', v_updated_count,
    'insertedCount', v_inserted_count,
    'deletedCount', v_deleted_count,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pbl.id,
        'item', pbl.item_name,
        'sku', ii.sku,
        'qty', pbl.qty,
        'status', pbl.status,
        'requestSpeed', pbl.request_speed,
        'po', pbl.po,
        'notes', pbl.notes,
        'procurementTrack', pbl.procurement_track,
        'sentToPurchasingAt', pbl.purchasing_sent_at,
        'shipTo', pbl.ship_to
      ) order by pbl.line_sort)
      from public.project_bom_lines pbl
      left join public.inventory_items ii on ii.id = pbl.inventory_item_id
      where pbl.project_id = p_project_id
    ), '[]'::jsonb)
  )
  into v_result_json;

  return v_result_json;
end;
$$;

revoke all on function public.replace_project_bom_lines(uuid, jsonb) from public;
revoke execute on function public.replace_project_bom_lines(uuid, jsonb) from anon;
grant execute on function public.replace_project_bom_lines(uuid, jsonb) to authenticated;

commit;

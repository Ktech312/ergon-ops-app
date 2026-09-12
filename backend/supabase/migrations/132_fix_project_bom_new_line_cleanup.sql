-- Migration 132: correct migration 131's new-line cleanup order.
--
-- Production verification of migration 131 found that a payload containing
-- new BOM lines (id = null) inserted those rows and then immediately deleted
-- them. The cleanup compared persisted ids only with incoming non-null ids,
-- so newly generated ids could never be present in that list.
--
-- This redefines the same function with the safe order:
--   1. update retained rows;
--   2. delete old rows omitted from the payload;
--   3. insert genuinely new rows.
-- All operations remain in one transaction under the parent project row lock.
-- It also includes the reviewed compatibility correction that quantity zero
-- remains valid for the app's existing Draft-project placeholder BOM rows.
-- No table, policy, data, or function signature changes.

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
    -- Zero is valid for the existing Draft-project placeholder rows (the
    -- Projects UI intentionally seeds "add expected count" lines at qty 0).
    -- Negative, missing, non-finite, and out-of-range quantities remain
    -- malformed input.
    if v_parsed_qty is null or v_parsed_qty < 0 then
      raise exception 'Every BOM line must have a quantity of zero or greater.' using errcode = 'EC020';
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
  -- Step 7: reconcile. Update retained lines in place, delete only OLD
  -- rows omitted from the payload, then insert genuinely new rows. The
  -- delete must run before the inserts because new payload rows have null
  -- ids and their generated ids cannot appear in the retained-id list.
  -- An explicit empty array deliberately clears the project's BOM.
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

  delete from public.project_bom_lines
  where project_id = p_project_id
    and id <> all(coalesce(array_remove(v_ids, null), array[]::uuid[]));
  get diagnostics v_deleted_count = row_count;

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

-- Phase 3, Stage 5 (workspace-scoped uniqueness, reports, aggregates,
-- functions, triggers, and remaining indirect access paths) -- first
-- migration of this stage, approved by E under the same 2026-09-16
-- standing authorization as migrations 155-162. Closes three real,
-- confirmed cross-workspace containment gaps found during a dedicated
-- Stage 5 scoping research pass across all 162 prior migrations -- not
-- structural cleanup, actual security bugs of the same T2/T8 class
-- already fixed elsewhere in Phase 3 (migrations 155/157/158/159), just
-- missed by those passes because the affected functions live in a
-- different file cluster than the ones those migrations grepped for.
--
-- Scope, this migration -- three RPCs, each carried forward VERBATIM
-- from its current live definition with only the targeted edit(s)
-- described below, re-read directly from source before writing this,
-- not from memory or from any planning doc:
--
--   1. `replace_project_bom_lines(p_project_id, p_lines)` (migration
--      131, latest def 132) -- checks the CALLER's workspace role, but
--      never checks that `p_project_id` actually belongs to the
--      caller's workspace: `select id into v_project_id from
--      public.projects where id = p_project_id for update` has no
--      `workspace_id` filter at all. A PM/admin in workspace A could
--      pass any workspace B project's id and have its BOM lines
--      replaced. Its `inventory_items` lookups (by id, sku, and name)
--      are also entirely workspace-blind, resolving to ANY workspace's
--      catalog item. Fixed by: (a) retiring the old Step 1
--      `active_workspace_id()` fail-closed guard (the "exactly one
--      workspace in the whole database" assumption, now obsolete --
--      `projects` and `inventory_items` both have real `workspace_id`
--      since migrations 156/159) in favor of a real per-project
--      comparison once the project row is loaded in Step 3, same
--      `resolve_caller_workspace_id()` + explicit-comparison pattern as
--      every other hardened RPC in this repo; (b) adding `and
--      workspace_id = v_caller_workspace_id` to every `inventory_items`
--      lookup in Step 5/6 (the id-existence check, both sku
--      cross-checks, and the name-match lookup).
--
--   2. `respond_to_proposal_question(p_question_id, p_answer_text)`
--      (migration 149, latest def 150) -- checks the caller's ROLE
--      (`is_app_admin()`/`has_role('sales')`/`has_role('manager')`) but
--      performs ZERO workspace check against the question's own
--      proposal/quote workspace. Any Sales rep/manager/admin in any
--      workspace could answer any OTHER workspace's client Q&A by
--      guessing/enumerating a question id. This is the exact class of
--      gap migration 155 already closed for this file's own sibling,
--      `respond_to_proposal_approval_request()` -- missed here because
--      `respond_to_proposal_question()` was added one migration later
--      (149, after 147) and fell outside every subsequent hardening
--      pass's review scope. Fixed by resolving the caller's workspace
--      and comparing it against the question's own resolved workspace
--      (via migration 158's existing `share_link_entity_workspace_id
--      ('sales_quote_proposal', v_proposal_id)` helper, reused directly
--      -- no new resolver needed) -- a mismatch is treated identically
--      to `not_found`, matching this function's own existing outcome
--      vocabulary and avoiding disclosing that a question exists in
--      another workspace at all.
--
--   3. `submit_proposal_question(share_token, question_text,
--      asker_name)` (migration 149, latest def 150) -- the anon-facing,
--      token-gated sibling of the RPC above. Correctly checks token
--      status/expiry/proposal status, but -- unlike this same file
--      cluster's `get_quote_proposal_by_token()`/`respond_to_quote_
--      proposal()` (both hardened in migration 155) -- never checks the
--      resolved workspace's own `status` (the "T8" suspended-workspace
--      check). A client could still submit a question against a share
--      link belonging to a suspended workspace. Fixed by adding the
--      identical check migration 155 already added to this table's own
--      sibling RPCs, mapped to the same `'unavailable'` outcome, in the
--      same relative position in the existing early-return chain
--      (after `expired`, before `closed`) -- via
--      `share_link_entity_workspace_id('sales_quote_proposal',
--      target_id)`, reused directly.
--
-- Re-confirmed while researching this migration: the "still calling
-- `active_workspace_id()`" list is now `replace_project_bom_lines()`
-- (retired by THIS migration) plus the legacy admin-role bridge
-- functions only (migrations 124/133, permanently out of scope --
-- documented since migration 155). `save_equipment_recipe()` was
-- already retired by migration 159 -- any planning-doc text still
-- listing it as a pending call site is stale and should be corrected
-- wherever found.
--
-- Confirm 163 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- replace_project_bom_lines(). Full body carried forward
-- from migration 132 (the current live definition), with exactly two
-- edits: the old Step 1 guard removed (old Step 2 becomes Step 1), and
-- a real per-project workspace comparison added to Step 3 (now Step 2)
-- immediately after the project row is loaded and locked.
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
  v_project_workspace_id uuid;
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
  -- Step 1: resolve the caller's workspace, then check role. STAGE 5:
  -- this was "Step 2" in migration 132; the old "Step 1"
  -- (active_workspace_id() fail-closed guard) is removed -- now
  -- obsolete, see this file's header.
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
  -- Step 2: load and lock the parent project row, and confirm it
  -- belongs to the caller's own workspace. FOR UPDATE here (not an
  -- advisory lock) is what serializes two concurrent replace calls for
  -- the SAME project. projects has no deleted_at column -- a plain
  -- existence check is all that's needed or possible here.
  -- STAGE 5: added workspace_id to the select list and the containment
  -- check immediately after -- this is the real fix this migration
  -- exists for.
  -- --------------------------------------------------------
  select id, workspace_id into v_project_id, v_project_workspace_id from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'This project could not be found -- it may have been deleted.' using errcode = 'EC019';
  end if;
  if v_project_workspace_id <> v_caller_workspace_id then
    raise exception 'This project does not belong to your workspace.' using errcode = 'EC002';
  end if;

  -- --------------------------------------------------------
  -- Step 3: structural validation, before any resolution or write.
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
    -- a plain `> 0` comparison alone does not reject NaN or Infinity
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
  -- Step 4/5: item identity resolution. A client-supplied STABLE
  -- identifier (inventory_item_id and/or sku) is untrusted input and is
  -- verified -- an invalid or mismatched stable identifier is a hard
  -- rejection, unlike the name-fallback path below. Only a line with
  -- NEITHER a stable identifier falls back to resolving item_name, and
  -- only an AMBIGUOUS (more than one match) name rejects the whole call --
  -- a name matching zero rows is tolerated (inventory_item_id stays null),
  -- matching saveProjectSites' current, unchanged behavior.
  -- STAGE 5: every inventory_items lookup below gains `and workspace_id =
  -- v_caller_workspace_id` -- previously workspace-blind, resolving to
  -- ANY workspace's catalog item.
  -- --------------------------------------------------------
  for v_i in 1 .. v_line_count loop
    if v_inventory_item_ids[v_i] is not null then
      if not exists (select 1 from public.inventory_items where id = v_inventory_item_ids[v_i] and workspace_id = v_caller_workspace_id) then
        v_invalid_identity_lines := array_append(v_invalid_identity_lines, v_item_names[v_i]);
      else
        v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, v_inventory_item_ids[v_i]);
        if v_skus[v_i] is not null then
          select id into v_sku_check_id from public.inventory_items where sku = v_skus[v_i] and workspace_id = v_caller_workspace_id;
          if v_sku_check_id is distinct from v_inventory_item_ids[v_i] then
            v_mismatched_lines := array_append(v_mismatched_lines, v_item_names[v_i]);
          end if;
        end if;
        continue;
      end if;
    elsif v_skus[v_i] is not null then
      select id into v_sku_check_id from public.inventory_items where sku = v_skus[v_i] and workspace_id = v_caller_workspace_id;
      if v_sku_check_id is null then
        v_invalid_identity_lines := array_append(v_invalid_identity_lines, v_item_names[v_i]);
      else
        v_resolved_inventory_item_ids := array_append(v_resolved_inventory_item_ids, v_sku_check_id);
        continue;
      end if;
    else
      select array_agg(id) into v_name_match_ids from public.inventory_items where item_name = v_item_names[v_i] and workspace_id = v_caller_workspace_id;
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
  -- Step 6: reconcile. Update retained lines in place, delete only OLD
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
  -- Step 7: return the full saved BOM line collection, including every
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

-- ============================================================
-- Section 2 -- respond_to_proposal_question(). Full body carried
-- forward from migration 150 (the current live definition), with the
-- caller-workspace resolution and question-workspace comparison added
-- right after the existing role check -- a mismatch is folded into the
-- SAME `not_found` branch the function already returns for a genuinely
-- nonexistent question id, not a new distinguishable outcome.
-- ============================================================

create or replace function public.respond_to_proposal_question(
  p_question_id uuid,
  p_answer_text text
)
returns table (
  outcome text,
  answered_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_caller_workspace_id uuid;
  v_question_status text;
  v_proposal_id uuid;
  v_proposal_status text;
  v_token_status text;
  v_token_expires_at timestamptz;
  v_trimmed_answer text;
  v_answered_at timestamptz;
begin
  if not (public.is_app_admin(v_actor_id) or public.has_role('sales') or public.has_role('manager')) then
    raise exception 'Only Sales, a manager, or an admin may answer a proposal question.' using errcode = 'EC001';
  end if;

  -- STAGE 5: resolve the caller's workspace up front -- used below to
  -- confirm the question actually belongs to it.
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  v_trimmed_answer := btrim(coalesce(p_answer_text, ''));
  if char_length(v_trimmed_answer) = 0 or char_length(v_trimmed_answer) > 4000 then
    raise exception 'Enter an answer of up to 4000 characters.' using errcode = 'EC001';
  end if;

  select q.status, q.proposal_id into v_question_status, v_proposal_id
  from public.sales_quote_proposal_questions q
  where q.id = p_question_id;

  if v_proposal_id is null then
    return query select 'not_found'::text, null::timestamptz;
    return;
  end if;

  -- STAGE 5: a question whose proposal belongs to ANOTHER workspace is
  -- reported identically to a genuinely nonexistent one -- never
  -- distinguished, so this never discloses that a question exists in a
  -- workspace the caller cannot access. Reuses migration 158's own
  -- share_link_entity_workspace_id() resolver directly, no new helper.
  if public.share_link_entity_workspace_id('sales_quote_proposal', v_proposal_id) is distinct from v_caller_workspace_id then
    return query select 'not_found'::text, null::timestamptz;
    return;
  end if;

  if v_question_status <> 'open' then
    return query select 'already_answered'::text, null::timestamptz;
    return;
  end if;

  select p.status into v_proposal_status from public.sales_quote_proposals p where p.id = v_proposal_id;

  select t.status, t.expires_at into v_token_status, v_token_expires_at
  from public.public_share_tokens t
  where t.entity_type = 'sales_quote_proposal' and t.entity_id = v_proposal_id;

  if v_proposal_status in ('approved', 'rejected')
    or v_token_status in ('superseded', 'temporarily_disabled', 'permanently_revoked')
    or (v_token_expires_at is not null and v_token_expires_at <= now())
  then
    return query select 'closed'::text, null::timestamptz;
    return;
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  update public.sales_quote_proposal_questions as sqpq
  set status = 'answered',
      answer_text = v_trimmed_answer,
      answered_by = v_actor_id,
      answered_by_email = v_actor_email,
      answered_at = now()
  where sqpq.id = p_question_id
  returning sqpq.answered_at into v_answered_at;

  return query select 'answered'::text, v_answered_at;
end;
$$;

revoke all on function public.respond_to_proposal_question(uuid, text) from public;
revoke execute on function public.respond_to_proposal_question(uuid, text) from anon;
grant execute on function public.respond_to_proposal_question(uuid, text) to authenticated;

-- ============================================================
-- Section 3 -- submit_proposal_question(). Full body carried forward
-- from migration 150 (the current live definition), with a
-- suspended-workspace ("T8") check added in the same relative position
-- as this table's own sibling RPCs (migration 155), between the
-- `expired` and `closed` checks -- mapped to the same `'unavailable'`
-- outcome already used for a disabled/revoked token.
-- ============================================================

create or replace function public.submit_proposal_question(
  share_token text,
  question_text text,
  asker_name text
)
returns table (
  outcome text,
  question_id uuid,
  asked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_quote_id uuid;
  proposal_status text;
  token_status text;
  token_expires_at timestamptz;
  trimmed_question text;
  new_question_id uuid;
  new_asked_at timestamptz;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
  v_workspace_status text;
begin
  trimmed_question := btrim(coalesce(question_text, ''));
  if char_length(trimmed_question) = 0 or char_length(trimmed_question) > 4000 then
    return query select 'invalid_input'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select t.status, t.expires_at, p.id, p.status, p.quote_id
  into token_status, token_expires_at, target_id, proposal_status, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal';

  if target_id is null then
    return query select 'invalid_token'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if token_status = 'superseded' then
    return query select 'superseded'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if token_status in ('temporarily_disabled', 'permanently_revoked') then
    return query select 'unavailable'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if token_expires_at is not null and token_expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- STAGE 5: the T8-class suspended-workspace check this function was
  -- missing -- its own sibling get_quote_proposal_by_token()/
  -- respond_to_quote_proposal() already gained this in migration 155.
  select w.status into v_workspace_status
  from public.workspaces w
  where w.id = public.share_link_entity_workspace_id('sales_quote_proposal', target_id);

  if coalesce(v_workspace_status, 'active') <> 'active' then
    return query select 'unavailable'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if proposal_status in ('approved', 'rejected') then
    return query select 'closed'::text, null::uuid, null::timestamptz;
    return;
  end if;

  insert into public.sales_quote_proposal_questions as sqpq (proposal_id, question_text, asker_name)
  values (target_id, trimmed_question, nullif(btrim(coalesce(asker_name, '')), ''))
  returning sqpq.id, sqpq.asked_at into new_question_id, new_asked_at;

  -- Notify the quote's owner -- best-effort, mirrors
  -- quote_proposal_responded's own established pattern exactly. A
  -- notification failure must never block the client's question from
  -- being recorded.
  begin
    select q.created_by_email, q.site_name into owner_email, quote_site_name
    from public.sales_quotes q where q.id = target_quote_id;

    select is_active into rule_active from public.notification_rules where event_type = 'proposal_question_received';

    if owner_email is not null and coalesce(rule_active, false) then
      insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
      values (
        owner_email,
        'proposal_question_received',
        'New question on a proposal',
        coalesce(quote_site_name, 'A quote') || ' -- ' || coalesce(nullif(btrim(coalesce(asker_name, '')), ''), 'the client') || ' asked: '
          || left(trimmed_question, 200),
        'sales_quote_proposal',
        target_id::text,
        'proposal_question_received:' || new_question_id::text
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  exception when others then
    null;
  end;

  return query select 'submitted'::text, new_question_id, new_asked_at;
end;
$$;

revoke all on function public.submit_proposal_question(text, text, text) from public;
revoke execute on function public.submit_proposal_question(text, text, text) from authenticated;
grant execute on function public.submit_proposal_question(text, text, text) to anon;

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see the standing Stage 5
-- research summary (PRODUCT_MASTER_COMPLETION_PLAN.md §11) for the full
-- list. In brief: workspace-scoped uniqueness on already-scoped tables
-- (clients.name, projects.project_name, vendors.name, inventory_items.sku,
-- purchase_orders.po_number, purchase_requests.request_number,
-- equipment_types.equipment_name/equipment_number,
-- project_documents.document_number, sales_quotes.quote_ref) and the
-- year-only-keyed ref-counter tables; the three report views
-- (report_inventory_on_hand/report_project_inventory_usage/
-- report_purchase_order_status), which need a live-database grant check
-- before a fix can be written safely; deletion_log's own workspace
-- scoping; storage bucket policies for purchase_order_files/
-- sales-quote-images/message-attachments; the governance decision on
-- notification_rules/standard_install_times/project_schedule_templates
-- (global config vs. per-workspace override -- needs E's input, not a
-- routine default); and the app_sync_events/app_transaction_locks
-- hygiene items (likely-dead table confirmation, a stray anon grant) --
-- each is its own separate migration or decision, not bundled here.
-- ============================================================

-- Carries the source quote's client_id onto the Project row that
-- create_project_from_quote() (migration 127) creates. sales_quotes and
-- projects have both had a nullable client_id column since migration
-- 102 -- confirmed by reading that migration directly, not assumed --
-- but 127's insert list never included it, so every quote-to-project
-- conversion silently drops the client link even when the quote had one.
-- PRODUCT_MASTER_COMPLETION_PLAN.md §4 item 7 / §5 Batch 4.
--
-- This migration preserves the ENTIRE 127 function body byte-for-byte
-- except for the one INSERT INTO public.projects statement (fresh-
-- creation branch only) -- every authorization check, active-workspace
-- resolution, idempotency short-circuit, unique-violation/receipt/error-
-- code, and result-shape guarantee already live is unchanged. No other
-- migration between 127 and 133 ever redefines this function's body
-- (confirmed by grep across every migration file); 128/130/131 only
-- touch the trigger chain and other RPCs this function calls into, not
-- this function's own text.
--
-- Deliberately NOT included in this batch: a human-readable quote
-- reference (quote_ref) carried onto Projects. quote_ref exists only on
-- sales_quotes (migration 066, trigger-assigned, unique) and projects
-- has no destination column for it at all -- only source_sales_quote_id,
-- an id already used for idempotency, not a human-readable reference.
-- Adding one needs a genuine new column and a naming decision (decision
-- D3 in CONTINUOUS_CODER_HANDOFF.md: recommended `source_quote_ref`,
-- keeping `source_sales_quote_id` as the durable link) -- out of scope
-- for this additive, decision-free batch.
--
-- Not applied. Kept local for E's review, same as every other migration
-- in this repository -- see HANDOFF.md for the current status of every
-- drafted-but-unapplied migration.

begin;

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
      -- Only change from migration 127: client_id added to both the
      -- column list and the values list, carrying the quote's own
      -- client_id (already selected via `select *` above -- both
      -- columns have existed since migration 102) straight onto the
      -- new Project row. Every other column, value, and the exception
      -- handler below are unchanged.
      insert into public.projects (
        project_name, customer_name, site_type, site_address, app_status, camera_count, notes,
        source_sales_quote_id, converted_from_quote_at, saas_type, saas_contract_amount,
        saas_billing_frequency, sale_amount, client_office_phone, billing_name, billing_address,
        client_id
      ) values (
        v_quote.site_name, nullif(v_quote.client_name, ''), v_site_type, v_address, 'Draft', v_camera_count,
        'Created from Closed - Won Sales Quote "' || v_quote.site_name || '".',
        p_quote_id, now(), nullif(v_quote.saas_type, ''), v_quote.saas_contract_amount,
        nullif(v_quote.saas_billing_frequency, ''), v_quote.sale_amount, nullif(v_quote.contact_phone, ''),
        nullif(v_quote.client_name, ''), v_billing_address,
        v_quote.client_id
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

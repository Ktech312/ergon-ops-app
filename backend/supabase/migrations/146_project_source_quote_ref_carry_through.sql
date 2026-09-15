-- Sales Batch 4b (D3, approved 2026-09-15): carries the source Sales
-- Quote's human-readable `quote_ref` (e.g. "SQ-2026-0004") onto the
-- converted Project as `source_quote_ref`, displayed as "Source Quote".
-- `source_sales_quote_id` (migration 127) remains the durable relational
-- link and is unchanged -- this is a second, purely display-facing
-- column, not a replacement. Historical conversion data: copied once at
-- conversion time, never live-synced afterward (if a quote's own
-- quote_ref could ever change post-conversion, which it cannot --
-- migration 066's trigger only assigns it once and 090+'s uniqueness
-- constraint means it's permanent -- this column would not follow that
-- change, matching this repo's established "frozen at conversion"
-- convention for accepted_proposal_total/client_id).
--
-- Two parts:
--   1. Schema + backfill. Unlike accepted_proposal_total (migration 136,
--      deliberately left NULL for existing projects because reconstructing
--      "which proposal version was accepted" requires a guess), this is
--      safely and exactly backfillable for every existing converted
--      project: source_sales_quote_id already links each one to its real
--      sales_quotes row, and that row's quote_ref already exists -- no
--      guessing required, so it is backfilled.
--   2. Redefine create_project_from_quote() to also populate
--      source_quote_ref going forward. Preserves migration 136's ENTIRE
--      function body byte-for-byte except for this one addition -- every
--      authorization check, active-workspace resolution, idempotency
--      short-circuit, unique-violation/receipt/error-code, and result-shape
--      guarantee already live is unchanged.
--
-- Confirm 146 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- 1a. Schema.
alter table public.projects
  add column if not exists source_quote_ref text;

-- 1b. Backfill every already-converted project. Exact, not a guess --
-- source_sales_quote_id already identifies the real source quote row.
update public.projects p
set source_quote_ref = sq.quote_ref
from public.sales_quotes sq
where p.source_sales_quote_id = sq.id
  and p.source_quote_ref is null;

-- 2. Redefine create_project_from_quote to also carry quote_ref onto the
--    new Project as source_quote_ref, alongside the existing
--    source_sales_quote_id relational link.
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
  v_accepted_proposal_total numeric(12,2);
begin
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

  begin
    select (content_snapshot->>'grandTotal')::numeric into v_accepted_proposal_total
    from public.sales_quote_proposals
    where quote_id = p_quote_id and status = 'approved'
    order by version desc
    limit 1;
  exception when others then
    v_accepted_proposal_total := null;
  end;

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

    v_address := nullif(concat_ws(', ',
      nullif(v_quote.site_street_address, ''), nullif(v_quote.city, ''),
      nullif(v_quote.site_state, ''), nullif(v_quote.site_zip, '')), '');
    v_billing_address := nullif(concat_ws(', ',
      nullif(v_quote.client_street_address, ''), nullif(v_quote.client_city, ''),
      nullif(v_quote.client_state, ''), nullif(v_quote.client_zip, '')), '');

    begin
      -- Only change from migration 136: source_quote_ref added to both
      -- the column list and the values list. Every other column, value,
      -- and the exception handler below are unchanged.
      insert into public.projects (
        project_name, customer_name, site_type, site_address, app_status, camera_count, notes,
        source_sales_quote_id, source_quote_ref, converted_from_quote_at, saas_type, saas_contract_amount,
        saas_billing_frequency, sale_amount, client_office_phone, billing_name, billing_address,
        client_id, accepted_proposal_total
      ) values (
        v_quote.site_name, nullif(v_quote.client_name, ''), v_site_type, v_address, 'Draft', v_camera_count,
        'Created from Closed - Won Sales Quote "' || v_quote.site_name || '".',
        p_quote_id, v_quote.quote_ref, now(), nullif(v_quote.saas_type, ''), v_quote.saas_contract_amount,
        nullif(v_quote.saas_billing_frequency, ''), v_quote.sale_amount, nullif(v_quote.contact_phone, ''),
        nullif(v_quote.client_name, ''), v_billing_address,
        v_quote.client_id, v_accepted_proposal_total
      )
      returning id into v_project_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'projects_source_sales_quote_id_key' then
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

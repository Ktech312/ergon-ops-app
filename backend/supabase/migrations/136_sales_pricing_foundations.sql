-- Queue C1 (2026-09-13): Frozen Sales pricing foundations. Implements the
-- statement E approved: catalog price starts each line; Sales may override
-- with an audit record; each sent proposal version freezes its own prices;
-- customers see unit price, line total, subtotal, percentage discount, tax,
-- and final total; costs/margin stay internal; the accepted final total
-- carries to the Project as a read-only reference; approval thresholds are a
-- separate later decision. Full design: PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md.
-- Confirm 136 is still the next free migration number at execution time.
--
-- Not applied. Kept local for E's review, same as every other migration in
-- this repository.

begin;

-- 1. Quote-line editable price + audit trail (PRODUCT_SALES_PRICING_
--    IMPLEMENTATION_PLAN.md §2/§3). price_source has THREE values, not two:
--    'catalog_default' (a NEW line, defaulted from the catalog at add time),
--    'manual_override' (a rep deliberately typed a different value), and
--    'legacy_unverified' (backfilled below for every row that existed before
--    this column did -- see the backfill's own comment for why this is
--    never labeled 'catalog_default').
alter table public.sales_quote_bom_lines
  add column if not exists unit_price numeric(12,2) not null default 0
    constraint sales_quote_bom_lines_unit_price_finite_nonnegative_check
      check (unit_price >= 0 and unit_price::text not in ('NaN', 'Infinity', '-Infinity')),
  add column if not exists price_source text not null default 'legacy_unverified'
    check (price_source in ('catalog_default', 'manual_override', 'legacy_unverified')),
  add column if not exists price_overridden_by uuid references auth.users(id),
  add column if not exists price_overridden_at timestamptz,
  add constraint sales_quote_bom_lines_price_override_audit_check
    check (
      (price_source = 'manual_override') =
      (price_overridden_by is not null and price_overridden_at is not null)
    );

-- The browser decides whether the edited value is a catalog default or a
-- manual override, but it is not trusted to attribute its own audit record.
-- For authenticated writes, Postgres always supplies the real caller and
-- database time. Direct SQL/service-role maintenance must provide a complete
-- pair explicitly, and the constraint above rejects incomplete metadata.
create or replace function public.stamp_sales_quote_price_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price_source = 'manual_override' then
    if auth.uid() is not null then
      new.price_overridden_by := auth.uid();
      new.price_overridden_at := pg_catalog.clock_timestamp();
    end if;
  else
    new.price_overridden_by := null;
    new.price_overridden_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_sales_quote_price_override on public.sales_quote_bom_lines;
create trigger trg_stamp_sales_quote_price_override
before insert or update of unit_price, price_source, price_overridden_by, price_overridden_at
on public.sales_quote_bom_lines
for each row execute function public.stamp_sales_quote_price_override();

revoke all on function public.stamp_sales_quote_price_override() from public;
revoke execute on function public.stamp_sales_quote_price_override() from anon;
revoke execute on function public.stamp_sales_quote_price_override() from authenticated;

-- 2. Quote-level discount/tax -- one of each per quote, not per line,
--    matching how a real deal is actually negotiated.
alter table public.sales_quotes
  add column if not exists discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  add column if not exists tax_rate numeric(5,2) not null default 0
    check (tax_rate >= 0 and tax_rate <= 100);

-- 3. Project-side accepted-total reference. Nullable, never backfilled --
--    reconstructing a historical accepted total for an already-converted
--    project is not possible without inventing a number; see the backfill
--    section below. No UI will ever offer to edit this from the Projects
--    side -- it is a read-only reference onto the Sales-side number, the
--    same convention already established for saas_contract_amount/
--    sale_amount (migrations 073/076), which are also one-time-copied and
--    never edited from Projects.
alter table public.projects
  add column if not exists accepted_proposal_total numeric(12,2)
    constraint projects_accepted_proposal_total_finite_nonnegative_check
      check (
        accepted_proposal_total is null
        or (
          accepted_proposal_total >= 0
          and accepted_proposal_total::text not in ('NaN', 'Infinity', '-Infinity')
        )
      );

-- 4. Backfill existing sales_quote_bom_lines rows. Every existing row
--    predates unit_price entirely, so there is no real recorded price to
--    recover -- only an estimate of what today's catalog would charge,
--    which may differ from what was actually quoted at the time. Per the
--    task's own instruction, this is NEVER labeled 'catalog_default' (that
--    label is reserved for a line whose default was verifiably taken from
--    the catalog at add time, going forward) -- every backfilled row is
--    'legacy_unverified' so the UI can visibly flag it for a rep's review
--    rather than silently presenting it as a confirmed price.
--
--    The estimate itself intentionally simplifies computeCatalogSellPrice's
--    frontend logic (src/main.tsx): it uses product_catalog.unit_cost
--    directly rather than also resolving a cost_source='inventory_unit_cost'
--    item's live-linked inventory cost via linked_reference fuzzy text
--    matching. product_catalog.unit_cost is documented as a fallback/
--    snapshot value even for that case (migration 046's own column
--    comment), so it is still a reasonable one-time estimate -- replicating
--    the frontend's exact fuzzy-match resolution inside a migration was
--    judged higher-risk than a slightly less precise, already-unverified
--    number.
update public.sales_quote_bom_lines bl
set unit_price = round(
  case
    when pc.unit_cost > 0 then pc.unit_cost * (1 + pc.markup_percent / 100)
    else coalesce(pc.default_sell_price, 0)
  end,
  2
)
from public.product_catalog pc
where bl.catalog_item_id = pc.id
;

-- Free-text lines (no catalog link) and any catalog-linked line whose
-- catalog_item_id no longer resolves (a deleted catalog item) keep the
-- column default of 0 -- there is nothing to estimate from at all, and
-- 'legacy_unverified' (already the column default) correctly flags that a
-- rep needs to fill this in, not that it was priced at $0 on purpose.

-- discount_percent/tax_rate need no backfill UPDATE: 0 is not a guess here,
-- it is the historically accurate value -- no quote before this feature
-- existed ever had a recorded discount or tax rate, so the column default
-- already IS the correct backfilled value for every existing row.

-- accepted_proposal_total is deliberately left NULL for every existing
-- project -- there is no reliable way to reconstruct which proposal
-- version (if any) was actually accepted for an already-converted project
-- without inventing a number, and the task's own instruction is explicit
-- that an unreconstructable history must be left an explicit unverified/
-- absent state, never inferred.

-- 5. Redefine create_project_from_quote to also carry the accepted
--    proposal's frozen grandTotal onto the new Project, when one exists.
--    Preserves migration 134's ENTIRE function body byte-for-byte except
--    for this one addition -- every authorization check, active-workspace
--    resolution, idempotency short-circuit, unique-violation/receipt/
--    error-code, and result-shape guarantee already live is unchanged.
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
  -- New: the accepted proposal's own frozen grand total, if one exists.
  -- Read from the LATEST version with status = 'approved' -- a quote can
  -- have several sent versions, only the one the client actually accepted
  -- should ever be reflected on the Project. grandTotal may be absent
  -- (an approved proposal sent before this feature existed) -- left NULL,
  -- never computed or guessed here.
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

  -- Computed unconditionally (fresh creation or idempotent short-circuit
  -- alike), same reasoning as the locations JSON below -- a retried call
  -- should see the same accepted total as the original call, not null the
  -- second time through. Wrapped in its own exception handler: a
  -- malformed/unexpected grandTotal value in some future snapshot must
  -- never abort the whole conversion -- this is a nice-to-have reference
  -- value, not a required field.
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
      -- Only change from migration 134: accepted_proposal_total added to
      -- both the column list and the values list. Every other column,
      -- value, and the exception handler below are unchanged.
      insert into public.projects (
        project_name, customer_name, site_type, site_address, app_status, camera_count, notes,
        source_sales_quote_id, converted_from_quote_at, saas_type, saas_contract_amount,
        saas_billing_frequency, sale_amount, client_office_phone, billing_name, billing_address,
        client_id, accepted_proposal_total
      ) values (
        v_quote.site_name, nullif(v_quote.client_name, ''), v_site_type, v_address, 'Draft', v_camera_count,
        'Created from Closed - Won Sales Quote "' || v_quote.site_name || '".',
        p_quote_id, now(), nullif(v_quote.saas_type, ''), v_quote.saas_contract_amount,
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

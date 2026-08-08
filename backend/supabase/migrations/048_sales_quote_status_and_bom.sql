-- Adds a real deal status to Site Builder Sales Quotes and a persisted,
-- editable BOM line list per quote. Two things this unlocks:
--   1. Only Closed-Won quotes are offered as a "pull the BOM from a closed
--      sale" source when building a Project (see main.tsx's Projects page,
--      "Build Sales BOM and Scope").
--   2. The relocated Pre-Sales Quick Estimate (category/node-count/cloud
--      sync calculator, moved here from Projects) has somewhere real to
--      write its output -- previously it only wrote into a Project's BOM,
--      but Sales doesn't manage Projects.
alter table sales_quotes add column if not exists status text not null default 'open' check (status in ('open', 'closed_won', 'closed_lost'));

create table if not exists sales_quote_bom_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references sales_quotes(id) on delete cascade,
  item_name text not null,
  qty numeric(10,2) not null default 1,
  notes text,
  line_sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_bom_lines_quote on sales_quote_bom_lines(quote_id, line_sort);

alter table sales_quote_bom_lines enable row level security;

-- Matches the existing wide-open sales_quotes/sales_quote_locations policies
-- (migration 033) -- no single role owns the Site Builder workflow yet.
create policy "authenticated read sales_quote_bom_lines"
  on sales_quote_bom_lines for select to authenticated using (true);

create policy "authenticated write sales_quote_bom_lines"
  on sales_quote_bom_lines for all to authenticated using (true) with check (true);

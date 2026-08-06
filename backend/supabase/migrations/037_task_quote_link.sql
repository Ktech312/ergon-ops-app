-- Links a task to the specific sales quote it was requested from, so the
-- Quote Builder list can show a real open-task count per quote instead of a
-- generic "Request" button. Nullable/optional -- only tasks created via the
-- per-quote Request button (inside a quote's detail page) get tagged; every
-- other task (Purchasing, Inventory, Projects, Product Catalog, etc.) is
-- unaffected.

alter table tasks add column if not exists quote_id uuid references sales_quotes(id) on delete set null;

create index if not exists idx_tasks_quote_id on tasks(quote_id);

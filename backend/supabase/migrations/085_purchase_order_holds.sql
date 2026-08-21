-- Migration 085: real "On Hold" reason log for Purchase Orders.
--
-- E, looking at the free-form status dropdown on Waiting on Receiving:
-- "I don't think this dropdown is useful, the status is useful but not
-- being able to change it here. the only thing that would be handy is
-- the On hold but that should trigger a box that asked why and then is
-- logged." Ordered/Received are driven by real events (Create Purchase,
-- actually receiving) -- letting someone just flip the dropdown to
-- either was never honest. On Hold is the one real manual action, and it
-- needs a reason on record.

create table if not exists purchase_order_holds (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  reason text not null,
  placed_by_email text,
  placed_at timestamptz not null default now()
);

create index if not exists idx_purchase_order_holds_order on purchase_order_holds(purchase_order_id, placed_at desc);

alter table purchase_order_holds enable row level security;

create policy "authenticated read purchase_order_holds"
  on purchase_order_holds for select to authenticated using (true);

create policy "authenticated write purchase_order_holds"
  on purchase_order_holds for all to authenticated using (true) with check (true);

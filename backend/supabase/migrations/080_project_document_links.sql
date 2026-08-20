-- Migration 080: real document -> order/request linking. E: "it sound
-- like it all goes to one bundle and not to the exact order places" --
-- Purchasing's document upload only ever matched a project by name, plus a
-- brittle filename guess against purchase_orders.source_file. This adds a
-- real, durable link so a document can point at the exact Purchase Order
-- or Purchase Request it belongs to. Both nullable/on delete set null --
-- most documents (general project files) link to neither.

alter table project_documents add column if not exists purchase_order_id uuid references purchase_orders(id) on delete set null;
alter table project_documents add column if not exists purchase_request_id uuid references purchase_requests(id) on delete set null;

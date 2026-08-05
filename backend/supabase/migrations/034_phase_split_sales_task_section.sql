-- Splits the single "sales" task section into "sales_catalog" and
-- "sales_quotes" so the Product Catalog and Quote Builder each get their
-- own focused task panel instead of one shared, undifferentiated bucket.
--
-- All existing "sales" rows predate the Quote Builder (which didn't exist
-- until today), so they're reassigned to sales_catalog as the closest
-- honest guess -- anyone can move an individual task to sales_quotes
-- afterward via its own Section dropdown, same as any other edit.

alter table tasks drop constraint if exists tasks_section_check;
alter table tasks add constraint tasks_section_check
  check (section in ('warehouse', 'purchasing', 'inventory', 'projects', 'sales_catalog', 'sales_quotes', 'engineering', 'general', 'sales'));

update tasks set section = 'sales_catalog' where section = 'sales';

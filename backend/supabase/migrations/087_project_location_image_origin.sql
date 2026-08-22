-- Migration 087: distinguish Sales-origin photos from Project photos on a
-- project location, so the two can be shown as separate, clearly labeled
-- groups instead of mixed together.
--
-- E: "When a sale is closed and transferred over to a new Project, the
-- images should transfer over also, in a folder labeled Sales, this keeps
-- pre project and Project images separate automatically." Images already
-- transferred on conversion (createProjectFromClosedWonQuote copies them
-- onto the matching new project_location) -- what was missing was any way
-- to tell them apart from photos added later during the actual project.
-- Confirmed approach: same location (not a separate "Sales" location),
-- tagged and grouped in the gallery UI.
--
-- origin defaults to 'project' for the normal upload path (nothing in the
-- app sets it explicitly there); createProjectFromClosedWonQuote's copy
-- step now stamps 'sales' on every image it carries over.

alter table project_location_images
  add column if not exists origin text not null default 'project' check (origin in ('sales', 'project'));

-- Backfill: any existing row that was copied over from a quote conversion
-- (its location has a source_quote_location_id) and predates the
-- conversion itself (uploaded_at is preserved from the original quote
-- upload, not reset at copy time, so this reliably identifies it) is a
-- Sales-origin photo. Anything uploaded after conversion is a real
-- Project photo, which is already the default.
update project_location_images pli
set origin = 'sales'
from project_locations pl
join projects p on p.id = pl.project_id
where pli.project_location_id = pl.id
  and pl.source_quote_location_id is not null
  and p.converted_from_quote_at is not null
  and pli.uploaded_at <= p.converted_from_quote_at;

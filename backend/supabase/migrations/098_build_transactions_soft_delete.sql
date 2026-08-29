-- Migration 098: soft-delete for build_transactions.
--
-- E: "I need to be able to delete these [cancelled builds], it should
-- just log if any user does, but i don't want a long list of cancelled
-- items." The Builds panel only ever shows the 6 most recent transactions
-- -- once a handful get cancelled during testing, they permanently occupy
-- those slots and push real Planned/Posted work out of view, with no way
-- to clear them. Same soft-delete + deletion_log shape as every other
-- entity (migration 088's pattern) -- never a hard DELETE.

alter table build_transactions add column if not exists deleted_by_email text;
alter table build_transactions add column if not exists deleted_at timestamptz;

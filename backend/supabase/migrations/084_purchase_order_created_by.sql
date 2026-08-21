-- Migration 084: track who placed each Purchase Order.
--
-- E wants to filter Waiting on Receiving / Completed by "who purchased
-- it" -- that data didn't exist anywhere on purchase_orders (the table
-- has an old requested_by uuid -> profiles(id) column from the original
-- schema, never populated by this app, and profiles isn't the auth
-- system this app actually uses). Adds a plain email column instead,
-- matching every other "who did this" field added this session
-- (requested_by_email, uploaded_by_email, received_by_email, etc.).

alter table purchase_orders add column if not exists created_by_email text;

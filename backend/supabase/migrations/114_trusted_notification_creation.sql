-- Phase: close the notifications INSERT gap (HANDOFF Questions/Decisions
-- #9). Until now `notifications` allowed ANY authenticated user to
-- insert a row addressed to ANY recipient with ANY event_type/title/
-- body/related_entity_* (migration 024: `with check (true)`) -- the
-- 2026-09-07 authorization pass closed "delivery can't diverge from the
-- record" (api/send-push.js etc. now read the stored row, not a second
-- client-supplied payload) but never closed "the record itself can't be
-- fabricated." This migration does that: all notification creation now
-- goes through api/create-notification.js (service-role key, strict
-- per-event-type validation/derivation), and the `authenticated` role
-- loses INSERT on this table entirely -- only the service-role key
-- (which bypasses RLS by default in Supabase) can write it now.
--
-- Ordering note: this migration is safe to run any time AFTER the app
-- code that stops calling the old direct-insert path has been deployed
-- (see HANDOFF.md) -- run it once E has confirmed the new
-- /api/create-notification route is live and working, not before.

-- Audit trail: which real signed-in user's action produced this
-- notification. Optional/nullable since the server route sets it, but
-- nothing before this migration ever did -- existing rows keep null.
alter table notifications add column if not exists created_by uuid references auth.users(id);

-- Recipients could already only ever SELECT/UPDATE their own rows (or
-- admin); this is unchanged. What changes is INSERT: drop the fully
-- open policy and add nothing back for `authenticated` -- only the
-- service-role key (used exclusively by api/create-notification.js)
-- can create a row now.
drop policy if exists "authenticated create notifications" on notifications;

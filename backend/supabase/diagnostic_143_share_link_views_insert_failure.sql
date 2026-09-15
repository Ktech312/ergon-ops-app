-- Diagnostic only (2026-09-14, v6) -- not a migration, nothing here is
-- meant to be kept or reused.
--
-- v5's result: the live get_submittal_by_token()'s own source does NOT
-- contain the string "insert into public.share_link_views" at all -- not
-- an RLS/grant/ownership problem (v5's throwaway probe function, with the
-- identical insert statement, succeeded fine). This means the DEPLOYED
-- function's actual logic appears to be missing migration 143's logging
-- code entirely -- possibly still the migration-139 version, from before
-- 143 was supposed to add it, or something else entirely. Rather than
-- guess further, this script just dumps the live source of BOTH functions
-- migration 143 touched, verbatim, so the actual deployed logic can be
-- read and compared directly against the migration file.
--
-- Read-only -- queries pg_get_functiondef() only, touches no table.
-- Nothing to roll back, but wrapped in begin;/rollback; anyway for
-- consistency with every other script in this investigation.

begin;

do $$
declare
  submittal_fn_source text;
  proposal_fn_source text;
begin
  select pg_get_functiondef('public.get_submittal_by_token(text)'::regprocedure) into submittal_fn_source;
  select pg_get_functiondef('public.get_quote_proposal_by_token(text)'::regprocedure) into proposal_fn_source;

  raise exception E'DIAGNOSTIC RESULT V6 -- LIVE FUNCTION SOURCE (verbatim):\n\n===== get_submittal_by_token (length=%) =====\n%\n\n===== get_quote_proposal_by_token (length=%) =====\n%',
    length(submittal_fn_source), submittal_fn_source,
    length(proposal_fn_source), proposal_fn_source;
end;
$$;

rollback;

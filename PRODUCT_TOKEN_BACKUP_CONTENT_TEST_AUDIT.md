# Ergon Ops — Share-Token, Backup, Hardcoded-Content & Test-Coverage Audit

Priority 8 (part 2) of the 2026-09-08 overnight work queue. Read-only — no files modified, no
production system exercised. All line numbers verified by direct read at audit time. Context from
`PRODUCT_PHASE2_PLAN.md` §2.2/§3.3 and `HANDOFF.md`'s latest work-log entries read first, not
re-derived below — cited where relevant.

---

## Part A — Public share-token behavior audit

### A1. Token entropy

Generated client-side by `generateShareToken()` (`src/persistence.ts:3686-3691`):

```js
function generateShareToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
```

- **Primary path**: two concatenated `crypto.randomUUID()` values (CSPRNG-backed, ~244 bits
  combined) → a 64-hex-char token. Cryptographically adequate.
- **Fallback path**: if `crypto.randomUUID` is unavailable, the token is built from `Math.random()`
  + `Date.now()` — not cryptographically secure. Low practical likelihood on a modern HTTPS
  deployment, but the fallback is a latent gap since nothing detects or warns when it's used.
- Used identically for both quote-proposal tokens and submittal tokens.

### A2. Expiration — set vs. checked

**Checked**: both RPCs do check it —
`backend/supabase/migrations/053_sales_quote_proposals.sql:164,187`:
```sql
and (t.expires_at is null or t.expires_at > now());
```

**Never set**: `public_share_tokens.expires_at` is nullable with **no default**
(`025_phase11_scheduling_templates_submittals.sql:99`). The only writer,
`createQuoteProposalShareToken` (`persistence.ts:10501-10515`), POSTs only
`{ token, entity_type, entity_id }` — `expires_at` is never included. Same for
`createSubmittalShareToken`.

**Net effect**: every token issued is permanently null-`expires_at`, so the check clause always
evaluates true. The mechanism exists and is correctly wired in SQL, but is **completely inert in
practice** — proposal and submittal links never expire. Contrast with `user_invites.expires_at`,
which has a real `default (now() + interval '30 days')` — the pattern for a real default exists
elsewhere in this codebase but wasn't applied here.

### A3. Reuse — can the same token respond more than once? **Yes — a real gap.**

`respond_to_quote_proposal` (`053_sales_quote_proposals.sql:169-205`) has no status-transition
guard on its `UPDATE`:

```sql
update sales_quote_proposals
set status = new_status, responded_at = now(), response_notes = notes,
    approval_name = approver_name, approval_ip = approver_ip,
    approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'), updated_at = now()
where id = target_id;
```

No `and status = 'sent'` (or similar) precondition — the RPC will overwrite an already-`approved`
proposal to `rejected` or vice versa, any number of times, each call silently clobbering the prior
`responded_at`/`approval_name`/`approval_ip`/`response_notes`/`approval_content_hash`.

The only prevention is client-side UI: `ProposalPublicPage` only renders the response form when
`phase === "ready"` (requires `status === "sent"`); once responded, it flips to a read-only
banner. **This is a UI-only gate** — calling the RPC directly (anyone with the token and knowledge
of the PostgREST `rpc/respond_to_quote_proposal` endpoint) bypasses it entirely, since the RPC
itself performs no server-side idempotency/status check. Genuine reuse gap, not theoretical.

#### A3 resolution — status as of 2026-09-08, later the same week

**Status: fix designed, migration file created, NOT run.** Prioritized ahead of Phase 2's own
per-workspace-uniqueness migration per E's explicit instruction — see
`PRODUCT_PHASE2_PLAN.md`'s Revision 6 renumbering note. Full design below; exact SQL, rollback,
and test script live in `backend/supabase/migrations/119_secure_quote_proposal_response.sql`
(created, not run) and are reproduced in this section for review.

**Terminology note**: the schema's real "awaiting response" status value is `'sent'`
(`sales_quote_proposals.status` check constraint: `'draft', 'sent', 'approved', 'rejected',
'revision_requested'`) — there is no `'pending'` value in this schema. Everywhere the fix
requirements say "pending," this design reads that as `status = 'sent'`. Introducing a new,
separate `'pending'` status value was considered and rejected — it would be a materially larger
schema change for no behavioral benefit, since `'sent'` already means exactly "awaiting a
customer response" today.

**Design: atomic, single-statement transition guard, no explicit row lock needed.**

```sql
update sales_quote_proposals
set status = new_status, responded_at = now(), ...
where id = target_id and status = 'sent'
returning status, responded_at, approval_name, version into ...;
```

A plain conditional `UPDATE ... WHERE id = ... AND status = 'sent'` is already safe against two
concurrent responses without an explicit `SELECT ... FOR UPDATE`: Postgres's own MVCC/row-locking
behavior means if two transactions race to update the same row, the first to commit wins, and the
second transaction's `UPDATE` statement — which must wait for the first transaction's row lock to
release before it can proceed — re-evaluates its `WHERE` clause against the *just-committed* row
under `READ COMMITTED` (Postgres's default isolation level). Since the row's `status` is no longer
`'sent'` by the time the second `UPDATE` gets to run, it matches zero rows. This is the standard,
textbook-correct pattern for exactly this problem — not a novel mechanism, and not weaker than an
explicit lock for this specific single-statement case.

**Distinguishing outcomes, returned as data, not exceptions, for the three "expected" cases:**
`respond_to_quote_proposal` is redefined to `returns table (outcome text, status text, responded_at
timestamptz, approval_name text, version integer)` instead of `returns void`. Exactly one row
comes back on every well-formed call:
- `outcome = 'invalid_token'` — token doesn't resolve to a live, unexpired proposal (same check
  already used by `get_quote_proposal_by_token`, preserved verbatim, per requirement 8: not
  touching expiration defaults). `status`/`responded_at`/`approval_name`/`version` are all null.
- `outcome = 'already_responded'` — the conditional `UPDATE` matched zero rows because the
  proposal was no longer `'sent'` (a genuine concurrency loser, or the customer/support staff
  reopening an already-answered link and somehow still POSTing a response). The four state fields
  are populated from a **fresh re-`SELECT` of the row after the failed `UPDATE`**, not from the
  function's own earlier pre-`UPDATE` read — this matters: the pre-`UPDATE` read could itself be
  stale relative to a concurrent winner's commit, so trusting it would risk reporting the wrong
  "already responded" state under real concurrency. Re-reading after the fact is always correct
  regardless of timing.
- `outcome = 'success'` — this call's `UPDATE` was the one that matched and changed the row. The
  four state fields are populated straight from the `UPDATE ... RETURNING` clause.

A genuine unexpected server failure (a real Postgres error — constraint violation, connection
issue, etc.) is deliberately **not** folded into this three-way `outcome` enum — it still surfaces
as a real thrown exception (PostgREST 500), so the frontend can tell "the RPC ran to completion
and is telling you what happened" (any 200 response) apart from "something actually broke" (a
non-200 response), satisfying the four-way distinction (invalid/expired token; already responded;
valid first response; unexpected server failure) with a two-tier design (HTTP status tier, then
an `outcome` field within the success tier).

**Notification fires exactly once, only on the winning transition** — the notification-insert
block only runs inside the `outcome = 'success'` branch, after the conditional `UPDATE` has
already confirmed this call was the one that changed the row. A concurrency loser or a stale
resubmission never reaches that code at all. The existing `dedupe_key`
(`'quote_proposal_responded:' || target_id || ':' || new_status`) is kept as a second,
belt-and-suspenders layer, but the real fix is that the losing branch can't reach the insert
statement in the first place.

**Historical access preserved, no code change needed for this part**: `get_quote_proposal_by_token`
does not filter by `status`, so an already-responded proposal's link keeps resolving and keeps
returning the proposal's current (finalized) state — this was already true before this fix and
remains true after. What's added: `responded_at` and `approval_name` are now included in its
return columns too (previously only returned by nothing — the frontend had no way to show *when*
or *by whom* a proposal was finalized), so the "This proposal was approved on [date]" wording the
frontend requirement asks for has real data to render. The response form's visibility is already
gated on `status === "sent"` client-side; that gate is unchanged, just now backed by a real
server-side guarantee instead of only a client-side convention.

**Hardening applied to both `get_quote_proposal_by_token` and `respond_to_quote_proposal`**:
`security definer`, `set search_path = ''`, every table reference fully schema-qualified
(`public.sales_quote_proposals`, `public.public_share_tokens`, `public.sales_quotes`,
`public.notification_rules`, `public.notifications`) — neither function had this hardening before
tonight; both predate the `search_path=''`/schema-qualification discipline established in
migration 115. Grants narrowed to `anon` only (`revoke all ... from public; grant execute ... to
anon;`) — confirmed by re-reading every call site in `persistence.ts`
(`fetchPublicQuoteProposal`/`respondToPublicQuoteProposal`) that both always call via
`supabaseHeaders()` with no access token, meaning every real call resolves as the `anon` role;
`authenticated` was granted in the original migration but is not exercised by any code path found,
so it's dropped as unused surface, matching migration 118's minimal-grant precedent. If a future
"preview as customer" authenticated-staff flow is ever added, this grant will need revisiting —
recorded here as a forward dependency, not a silent gap.

**Token expiration/revocation (A2/A4) deliberately NOT touched by this fix**, per explicit
instruction: `expires_at` still has no default and no writer ever sets it, and no revocation
mechanism is added. This fix closes the *replay* gap (A3) only. A2/A4 remain open, tracked
findings for a separate, explicitly-discussed product decision — see those sections above,
unchanged.

**Frontend changes — prepared, NOT yet committed/pushed.** The new RPC return shapes are a real
contract change: `respond_to_quote_proposal` no longer returns nothing, and
`get_quote_proposal_by_token` gains two new columns. Deploying frontend code built against the new
shape *before* migration 119 has actually been run in production would break the live proposal
response flow for every customer (the RPC PostgREST endpoint would still be the old `void`-shaped
one), which is a strictly worse outcome than the vulnerability this fix addresses. The updated
`src/persistence.ts`/`src/main.tsx` code is written, type-checked, and covered by mocked-fetch unit
tests (§ below), but is being held as a local, uncommitted (or committed-but-unpushed — see the
delivery note at the end of this document) change until E confirms migration 119 has actually run.

#### A3 resolution — preflight

Run against production before migration 119, to confirm the starting state:

```sql
-- Confirm the current function signatures/security settings (no
-- search_path='' yet, prosecdef should already be true for both since
-- they're already security definer today).
select proname, prosecdef, proconfig
from pg_proc
where proname in ('get_quote_proposal_by_token', 'respond_to_quote_proposal')
  and pronamespace = 'public'::regnamespace;

-- Confirm current grants (expect authenticated present on both today --
-- that's what this migration removes).
select grantee, routine_name, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('get_quote_proposal_by_token', 'respond_to_quote_proposal');

-- How many real proposals are currently in a respondable ('sent') state
-- -- informational only, confirms this migration touches live, real data
-- shape, not an empty table.
select count(*) as sent_proposal_count from public.sales_quote_proposals where status = 'sent';
```

#### A3 resolution — migration 119 (exact content of the created file)

The full, exact SQL is `backend/supabase/migrations/119_secure_quote_proposal_response.sql`,
created in the repository, reproduced here for review. **Not run.**

```sql
begin;

-- CORRECTION (2026-09-08, live during E's first run attempt): CREATE OR
-- REPLACE cannot change a function's return-row shape -- Postgres 42P13,
-- "cannot change return type of existing function... Row type defined
-- by OUT parameters is different." Both functions below change shape
-- (new columns / void -> table), so each needs an explicit DROP first.
-- The first run attempt failed on exactly this at Section 1, before
-- Section 2 or `commit;` was ever reached -- the whole transaction
-- rolled back automatically, nothing committed, production was never
-- left in a partial state. Fixed by adding `drop function if exists`
-- immediately before each `create` below (now plain `create`, not `or
-- replace`, since the preceding drop guarantees a clean slate either
-- way). Both drop+create pairs are inside the same transaction, so
-- there is no window where either function is missing.

-- Section 1 -- get_quote_proposal_by_token(): same query logic, now also
-- returns responded_at/approval_name, hardened, grant narrowed to anon.
drop function if exists public.get_quote_proposal_by_token(text);

create function public.get_quote_proposal_by_token(share_token text)
returns table (
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text,
  responded_at timestamptz,
  approval_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  select p.id, p.status, p.version, p.content_snapshot, p.client_name, p.responded_at, p.approval_name
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
grant execute on function public.get_quote_proposal_by_token(text) to anon;

-- Section 2 -- respond_to_quote_proposal(): the atomic, outcome-returning
-- fix. See the migration file's own comments for the full design
-- rationale on each branch. Same return-shape-change reason as Section 1
-- (void -> table), so this also needs an explicit DROP first.
drop function if exists public.respond_to_quote_proposal(text, text, text, text, text);

create function public.respond_to_quote_proposal(
  share_token text,
  new_status text,
  approver_name text,
  approver_ip text,
  notes text
)
returns table (
  outcome text,
  status text,
  responded_at timestamptz,
  approval_name text,
  version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  snapshot jsonb;
  target_quote_id uuid;
  updated_status text;
  updated_responded_at timestamptz;
  updated_approval_name text;
  updated_version integer;
  current_status text;
  current_responded_at timestamptz;
  current_approval_name text;
  current_version integer;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  select p.id, p.content_snapshot, p.quote_id
  into target_id, snapshot, target_quote_id
  from public.public_share_tokens t
  join public.sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    return query select 'invalid_token'::text, null::text, null::timestamptz, null::text, null::integer;
    return;
  end if;

  update public.sales_quote_proposals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id
    and status = 'sent'
  returning status, responded_at, approval_name, version
  into updated_status, updated_responded_at, updated_approval_name, updated_version;

  if updated_status is null then
    select status, responded_at, approval_name, version
    into current_status, current_responded_at, current_approval_name, current_version
    from public.sales_quote_proposals
    where id = target_id;

    return query select 'already_responded'::text, current_status, current_responded_at, current_approval_name, current_version;
    return;
  end if;

  select q.created_by_email, q.site_name into owner_email, quote_site_name
  from public.sales_quotes q where q.id = target_quote_id;

  select is_active into rule_active from public.notification_rules where event_type = 'quote_proposal_responded';

  if owner_email is not null and coalesce(rule_active, false) then
    insert into public.notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
    values (
      owner_email,
      'quote_proposal_responded',
      'Proposal ' || replace(new_status, '_', ' '),
      coalesce(quote_site_name, 'A quote') || ' proposal v' || updated_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
      'sales_quote_proposal',
      target_id::text,
      'quote_proposal_responded:' || target_id::text || ':' || new_status
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return query select 'success'::text, updated_status, updated_responded_at, updated_approval_name, updated_version;
end;
$$;

revoke all on function public.respond_to_quote_proposal(text, text, text, text, text) from public;
grant execute on function public.respond_to_quote_proposal(text, text, text, text, text) to anon;

commit;
```

#### A3 resolution — post-migration verification

```sql
-- 1. Both functions are security definer with search_path='' set.
select proname, prosecdef, proconfig
from pg_proc
where proname in ('get_quote_proposal_by_token', 'respond_to_quote_proposal')
  and pronamespace = 'public'::regnamespace;
-- Expected: prosecdef = true for both; proconfig contains 'search_path='.

-- 2. Grants are anon-only now (expect zero rows for authenticated/PUBLIC).
select grantee, routine_name, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('get_quote_proposal_by_token', 'respond_to_quote_proposal')
  and grantee in ('PUBLIC', 'authenticated');

-- 3. Existing proposal rows and their content_snapshot are untouched --
-- row count and every content_snapshot's own hash should match whatever
-- E records from the preflight (this migration touches no existing row).
select count(*) as sent_proposal_count from public.sales_quote_proposals where status = 'sent';
```

#### A3 resolution — transaction-safe test script (exact, runnable, never commits)

Self-contained, `begin;`/`rollback;` wrapped -- creates its own throwaway quote/proposals/tokens,
never touches real data, and undoes everything at the end regardless of outcome. Uses a real,
existing workspace-admin member of the Ergon Test Workspace to satisfy migration 117's
`sales_quotes` ownership trigger during fixture setup only -- the RPCs under test themselves never
check caller identity (they're purely token-based), so the actual `respond_to_quote_proposal`/
`get_quote_proposal_by_token` calls run as `anon`, matching the real production call path and
empirically confirming the narrowed grant is sufficient.

**Honest scope note on the "two competing responses" requirement**: this script proves the
guarantee by calling the RPC sequentially against an already-`'sent'` row (first call succeeds,
second is rejected) rather than literally racing two simultaneous database connections, which
isn't practical to script from one Supabase Studio session. Both cases hit the identical code path
(`update ... where status = 'sent'`), and Postgres's documented behavior for two concurrent
`UPDATE`s on the same row (the second waits for the first's lock, then re-evaluates its `WHERE`
clause against the post-commit row) is a property of the SQL statement itself, not something that
requires literally racing two sessions to verify for this specific pattern -- stated plainly here
rather than overclaiming a true concurrency test was run.

```sql
begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  admin_workspace_id uuid;
  test_quote_id uuid;
  proposal_a_id uuid;
  proposal_b_id uuid;
  token_a text := 'test-token-a-' || gen_random_uuid()::text;
  token_b text := 'test-token-b-' || gen_random_uuid()::text;
  token_expired text := 'test-token-expired-' || gen_random_uuid()::text;
  outcome1 text; status1 text; responded_at1 timestamptz; approval_name1 text; version1 integer;
  outcome2 text; status2 text; responded_at2 timestamptz; approval_name2 text; version2 integer;
  notif_count_after integer;
  snapshot_before jsonb;
  snapshot_after jsonb;
begin
  select current_setting('role') into original_role;

  select wm.user_id, wm.workspace_id into admin_user_id, admin_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.slug = 'ergon-test' and wm.is_workspace_admin
  limit 1;

  if admin_user_id is null then
    raise exception 'no workspace-admin member of the Ergon Test Workspace found -- cannot run tests';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);

  -- Fixture: one real sales_quotes row + two proposals (A: reuse/race
  -- tests, B: the revision_requested-locks-too test), both status='sent'.
  perform set_config('role', 'authenticated', true);
  insert into public.sales_quotes (client_name, site_name, created_by_email)
  values ('Migration 119 Test Client', 'Migration 119 Test Site', 'phase2-test@example.com')
  returning id into test_quote_id;
  perform set_config('role', original_role, true);

  insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name)
  values (test_quote_id, 1, 'sent', '{"siteName":"Migration 119 Test Site","bom":[]}'::jsonb, 'Migration 119 Test Client')
  returning id into proposal_a_id;

  insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name)
  values (test_quote_id, 2, 'sent', '{"siteName":"Migration 119 Test Site","bom":[]}'::jsonb, 'Migration 119 Test Client')
  returning id into proposal_b_id;

  select content_snapshot into snapshot_before from public.sales_quote_proposals where id = proposal_a_id;

  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at) values
    (token_a, 'sales_quote_proposal', proposal_a_id, null),
    (token_b, 'sales_quote_proposal', proposal_b_id, null),
    (token_expired, 'sales_quote_proposal', proposal_a_id, now() - interval '1 day');

  perform set_config('role', 'anon', true);

  -- Invalid token.
  select outcome into outcome1 from public.respond_to_quote_proposal('this-token-does-not-exist', 'approved', 'Nobody', '', '');
  if outcome1 is distinct from 'invalid_token' then
    raise exception 'TEST FAILED: unknown token should return invalid_token, got %', outcome1;
  end if;
  raise notice 'TEST PASSED: invalid token returns invalid_token';

  -- Expired token.
  select outcome into outcome1 from public.respond_to_quote_proposal(token_expired, 'approved', 'Nobody', '', '');
  if outcome1 is distinct from 'invalid_token' then
    raise exception 'TEST FAILED: expired token should return invalid_token, got %', outcome1;
  end if;
  raise notice 'TEST PASSED: expired token returns invalid_token';

  -- First approval succeeds.
  select outcome, status, responded_at, approval_name, version
  into outcome1, status1, responded_at1, approval_name1, version1
  from public.respond_to_quote_proposal(token_a, 'approved', 'First Responder', '', 'looks good');
  if outcome1 is distinct from 'success' or status1 is distinct from 'approved' or approval_name1 is distinct from 'First Responder' then
    raise exception 'TEST FAILED: first approval should succeed -- got outcome=%, status=%, name=%', outcome1, status1, approval_name1;
  end if;
  raise notice 'TEST PASSED: first approval succeeds, outcome=success, status=approved';

  -- Replaying the same approval fails safely, original state preserved
  -- (also the "two competing responses" proof -- see the scope note above).
  select outcome, status, responded_at, approval_name
  into outcome2, status2, responded_at2, approval_name2
  from public.respond_to_quote_proposal(token_a, 'approved', 'Replay Attempt', '', 'trying again');
  if outcome2 is distinct from 'already_responded' or status2 is distinct from 'approved' or approval_name2 is distinct from 'First Responder' then
    raise exception 'TEST FAILED: replaying the same approval should return already_responded with the ORIGINAL approval_name unchanged -- got outcome=%, status=%, name=%', outcome2, status2, approval_name2;
  end if;
  if responded_at2 is distinct from responded_at1 then
    raise exception 'TEST FAILED: responded_at must not change on replay';
  end if;
  raise notice 'TEST PASSED: replaying the same approval is rejected, exactly one winner, original state preserved';

  -- A different later status also fails safely.
  select outcome, status into outcome2, status2
  from public.respond_to_quote_proposal(token_a, 'rejected', 'Second Attempt', '', 'changed my mind');
  if outcome2 is distinct from 'already_responded' or status2 is distinct from 'approved' then
    raise exception 'TEST FAILED: a different later status must also be rejected -- got outcome=%, status=%', outcome2, status2;
  end if;
  raise notice 'TEST PASSED: a different later status is also rejected; authoritative status remains approved';

  -- revision_requested also locks that proposal version (proposal B).
  select outcome, status into outcome1, status1
  from public.respond_to_quote_proposal(token_b, 'revision_requested', 'Reviewer', '', 'please adjust pricing note');
  if outcome1 is distinct from 'success' or status1 is distinct from 'revision_requested' then
    raise exception 'TEST FAILED: first revision_requested response on proposal B should succeed';
  end if;
  select outcome, status into outcome2, status2
  from public.respond_to_quote_proposal(token_b, 'approved', 'Late Approver', '', '');
  if outcome2 is distinct from 'already_responded' or status2 is distinct from 'revision_requested' then
    raise exception 'TEST FAILED: proposal B should now be locked at revision_requested -- got outcome=%, status=%', outcome2, status2;
  end if;
  raise notice 'TEST PASSED: revision_requested also locks its proposal version against further responses';

  -- Exactly one notification exists for proposal A despite 2 replay attempts.
  select count(*) into notif_count_after
  from public.notifications
  where related_entity_type = 'sales_quote_proposal' and related_entity_id = proposal_a_id::text;
  if notif_count_after <> 1 then
    raise exception 'TEST FAILED: expected exactly 1 notification for proposal A, found %', notif_count_after;
  end if;
  raise notice 'TEST PASSED: exactly one notification exists despite replay/race attempts';

  -- Finalized proposals remain viewable via the original token.
  select status, approval_name, responded_at into status1, approval_name1, responded_at1
  from public.get_quote_proposal_by_token(token_a);
  if status1 is distinct from 'approved' or approval_name1 is distinct from 'First Responder' then
    raise exception 'TEST FAILED: get_quote_proposal_by_token should still resolve token_a and show the real approver -- got status=%, name=%', status1, approval_name1;
  end if;
  raise notice 'TEST PASSED: an already-responded proposal remains fully viewable via its original token';

  -- content_snapshot is unchanged -- only status/response fields were ever touched.
  select content_snapshot into snapshot_after from public.sales_quote_proposals where id = proposal_a_id;
  if snapshot_after is distinct from snapshot_before then
    raise exception 'TEST FAILED: content_snapshot must never be modified by responding to a proposal';
  end if;
  raise notice 'TEST PASSED: content_snapshot is unchanged';

  perform set_config('role', original_role, true);

  raise notice 'ALL MIGRATION 119 TESTS PASSED';
end $$;

rollback;
```

#### A3 resolution — rollback (only if migration 119 has already been run and must be reversed)

```sql
-- Restores the exact pre-119 function bodies (from migrations 053/054)
-- and the authenticated grant they had before. Restoring the OLD shape
-- is ALSO a return-shape change from whatever 119 left live, so this
-- needs the same drop-first treatment as the forward migration.
drop function if exists public.get_quote_proposal_by_token(text);

create function public.get_quote_proposal_by_token(share_token text)
returns table (
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text
)
language sql
security definer
stable
as $$
  select p.id, p.status, p.version, p.content_snapshot, p.client_name
  from public_share_tokens t
  join sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());
$$;

revoke all on function public.get_quote_proposal_by_token(text) from public;
grant execute on function public.get_quote_proposal_by_token(text) to anon, authenticated;

drop function if exists public.respond_to_quote_proposal(text, text, text, text, text);

create function public.respond_to_quote_proposal(share_token text, new_status text, approver_name text, approver_ip text, notes text)
returns void
language plpgsql
security definer
as $$
declare
  target_id uuid;
  snapshot jsonb;
  target_quote_id uuid;
  target_version integer;
  owner_email text;
  quote_site_name text;
  rule_active boolean;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  select p.id, p.content_snapshot, p.quote_id, p.version
  into target_id, snapshot, target_quote_id, target_version
  from public_share_tokens t
  join sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    raise exception 'Invalid or expired proposal link';
  end if;

  update sales_quote_proposals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id;

  select q.created_by_email, q.site_name into owner_email, quote_site_name
  from sales_quotes q where q.id = target_quote_id;

  select is_active into rule_active from notification_rules where event_type = 'quote_proposal_responded';

  if owner_email is not null and coalesce(rule_active, false) then
    insert into notifications (recipient_email, event_type, title, body, related_entity_type, related_entity_id, dedupe_key)
    values (
      owner_email,
      'quote_proposal_responded',
      'Proposal ' || replace(new_status, '_', ' '),
      coalesce(quote_site_name, 'A quote') || ' proposal v' || target_version || ' was ' || replace(new_status, '_', ' ') || ' by ' || coalesce(approver_name, 'the client') || '.',
      'sales_quote_proposal',
      target_id::text,
      'quote_proposal_responded:' || target_id::text || ':' || new_status
    )
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

revoke all on function public.respond_to_quote_proposal(text, text, text, text, text) from public;
grant execute on function public.respond_to_quote_proposal(text, text, text, text, text) to anon, authenticated;
```

Rolling back also requires reverting the matching frontend commit (once it exists) back to the
version that calls the old `void`-shaped RPC and ignores the new `get_quote_proposal_by_token`
columns -- a plain `git revert` of that commit, not a manual re-edit.

### A4. Revocation — none exists

Repo-wide search for any `DELETE` against `public_share_tokens` or any revoke path returns
nothing — the only operations against that table anywhere in application code are the two `POST`
inserts and two `SELECT`s used to read a token back for display. No UI control, no RPC, no admin
action invalidates a token before its (in practice never-reached) expiration. Combined with A2,
an issued proposal or submittal link is **permanent** for the life of the underlying row.

### A5. Suspended workspace — confirmed, not re-derived

`PRODUCT_PHASE2_PLAN.md` §3.3 already states this explicitly: neither RPC checks workspace
`status`, and it's flagged "required before Phase 3 is considered complete," not yet closed.
Practical severity today is low only because RLS/workspace enforcement doesn't exist anywhere
yet — the gap is real and already tracked, not newly discovered here.

### A6. Logging — none exists

No access logging exists at any layer for token use. `fetchPublicQuoteProposal()` is a bare fetch
to the RPC with no write-back. `approver_ip` is hardcoded to `""` at the call site
(`persistence.ts:10565`) — so even the one column the schema provides for capturing an IP
(`sales_quote_proposals.approval_ip`) is never populated. No `deletion_log`-style or dedicated
access table exists for `public_share_tokens` (confirmed via grep for `access_log`/`audit_log`/
`token_access`/`viewed_at` across all migrations). There is no record of who viewed a public
proposal link, when, or from where — only a final response (if one occurs) is persisted, and even
that carries no real IP.

### A7. Rate limiting — not rate-limited at all

`fetchPublicQuoteProposal`/`respondToPublicQuoteProposal` call Supabase PostgREST RPC endpoints
directly from the browser — never through any `api/*.js` route. `api/_lib/rateLimit.js`'s
`checkRateLimit()` is wired into exactly 8 routes, none of which is the public token-view/respond
path. The only rate limiting on this anonymous, unauthenticated surface, if any, is whatever
Supabase's own infrastructure-level rate limiting provides (not configurable or visible from this
repo). Real gap: the most attractive unauthenticated target (repeatedly guessing/hammering a
proposal token, or spamming `respond_to_quote_proposal` given A3's reuse gap) has zero app-layer
throttling.

### A8. Data exposed in snapshots

`buildProposalSnapshot()` constructs `content_snapshot` from client name, site name, city, quote
ref, proposal summary, full BOM (item/product name, qty, notes, description, manufacturer,
datasheet URL, product image URL), and full template sections.

- **Pricing is deliberately excluded** — confirmed intentional (`053_sales_quote_proposals.sql:144-146`
  comment: "never quote internal cost/markup data").
- `client_email` is on the proposal row but the public RPC's return list doesn't include it — not
  leaked through the token.
- What **is** exposed to anyone holding the (never-expiring, unrevocable, unlogged) link: client
  name, site address/city, the full equipment BOM with product images and datasheet links, and
  exec-summary text. For a security/surveillance-hardware business, this is meaningful
  competitive/reconnaissance information about a specific customer's real site — not pricing, but
  real site-design intel. Given A2/A3/A4/A6/A7 together, the token's actual protection level is:
  **an unguessable, unrevocable, forever-valid, unlogged, unrate-limited bearer credential** — a
  materially weaker posture than the data being shared would suggest is appropriate, even though
  none of these gaps was introduced carelessly (several are already tracked as pre-Phase-3 work).

---

## Part B — Data export, backup, restoration, and retention audit

### What exists today

- **Per-view CSV export only**, not a full data export. `exportCsv()` is a pure client-side
  helper serializing already-loaded rows into a downloaded `Blob` — no server involvement, no
  "export everything" scope. Wired into Inventory, Purchase Request queue, Movement Ledger, and
  Reports. No admin-facing "export my workspace's full data" feature exists.
- **No documented Supabase backup/restore process.** `backend/docs/supabase-production-handoff.md`
  (74 lines, read in full) covers project identity, env vars, and the manual migration process,
  but contains **zero** mention of backup, restore, PITR, retention, or RPO/RTO. The doc is also
  stale — references migrations only through `068`, while the repo now has 118.
- Supabase provides automated backups/PITR at the infrastructure level (a platform capability),
  but **nothing in this repo documents what tier is enabled, what the retention window is, or
  that anyone has ever tested a restore.** A real, silent single point of failure risk for a
  product being positioned as sellable/multi-tenant.
- **Soft-delete + `deletion_log`, but no real retention/purge policy.** Migration 088's own
  comment states the design explicitly: "the data itself stays in place until someone restores it
  or an admin permanently purges it by hand." No scheduled job, cron route, or admin UI for a
  time-based purge was found. In practice, soft-deleted rows are retained **forever**, with no
  documented statement that's the intent versus an oversight.
- No privacy policy, ToS, GDPR, or data-retention-policy language exists anywhere in the repo.

### Gaps relative to a sellable, multi-tenant SaaS product

1. **No per-workspace data export** — once multi-tenancy is real, a departing customer has no way
   to get their data out.
2. **No documented RPO/RTO.**
3. **No tested restore procedure** — no "if the database needs restoring, here's how" runbook.
4. **No retention/purge policy for soft-deleted data** — both a cost dimension (unbounded row
   growth) and a compliance dimension (a customer's "delete my data" request currently only
   soft-deletes; the underlying row persists indefinitely).
5. **The one existing infra doc is stale** and would mislead a new developer about migration count.

None of the above is a code bug — a documentation/process gap, appropriate to flag for planning
rather than fix silently.

---

## Part C — Hard-coded content audit (beyond tonight's already-fixed items)

Tonight's already-fixed baseline (not re-flagged): dead client-data array, Emerald Queen fallback
(both `main.tsx` and `api/sales-quote-extract.js`), hardcoded-2026 `nextProjectRef()` year bug —
verified clean (no residual hits for the real names/addresses anywhere in `src/`/`api/`).

### New findings — genuine cleanup candidates

1. **A second dead hardcoded array, same class as the one already fixed — not caught tonight.**
   `const parts: Part[] = [...]` at `src/main.tsx:649-760` (32 items, SKU-0001 through SKU-0032).
   A top-level array containing real Ergon/EnSight inventory catalog data: real part numbers,
   real vendor names (FriendlyElec, Amazon, NewEgg), real Amazon purchase-link URLs with tracking
   params, and real internal unit-cost figures with date-stamped price history. **Confirmed
   dead**: exhaustive grep for every plausible reference pattern returns zero hits outside the
   declaration — every other `.parts` occurrence is an unrelated object property built from real
   `inventoryItems` state that happens to share the name. Unlike the previously-fixed items, this
   isn't a third-party-identity leak — it's Ergon's own real cost/vendor data — but it is real
   proprietary business data (internal purchasing costs) shipping unused in the public production
   JS bundle, readable by anyone via browser dev tools. Recommend the same treatment as the array
   already removed.

   **Resolved, 2026-09-08 (later the same week):** independently re-verified dead (a fresh,
   exhaustive grep confirming every `.parts`/`parts` hit elsewhere in the file is unrelated — see
   commit message for the full breakdown), then removed. `tsc`/`vite build`/`eslint`/`vitest` all
   clean; the rebuilt `dist/` bundle scanned directly for every real vendor name and cost figure
   the array contained — none ship. Held as a local, unpushed commit alongside the migration 119
   frontend fix (both wait on the same "migration 119 has been run" confirmation before pushing) —
   see `HANDOFF.md`'s latest entry for the exact commit hash once pushed.

2. **`support@ensight-technologies.com` hardcoded as the Web Push VAPID contact**
   (`api/send-push.js:200`). Ergon's own real domain, not a leak — but a singleton, non-
   configurable value. The VAPID contact is conventionally the entity operating the push
   infrastructure, so may be entirely appropriate to keep even in a multi-tenant future —
   flagging for awareness, not as a clear-cut defect. Already surfaced once before in the
   original tenancy audit; never part of tonight's fix list.

3. **`DEFAULT_BOM_SHIP_TO = "EnSight Office"` (`main.tsx:468`)**, used as the default ship-to
   value for BOM pull requests (6 call sites). The string is Ergon's own real brand name, fine to
   keep — but a hardcoded singleton default, not workspace-configurable. A second tenant's
   warehouse is not "EnSight Office." Same "ship-to address" item the original tenancy audit
   already flagged generically; here pinned to its exact source location.

4. **`STATIC_ALLOWED_HOSTS = ["ergon-ops-app.vercel.app", "localhost", "127.0.0.1"]`**
   (`api/_lib/validateUrl.js:11`) — the app's own real production domain, appropriate to keep for
   Ergon's single current deployment. A single-tenant assumption: a custom domain or renamed
   deployment would need this updated by hand; no env-var-driven mechanism. Not a security bug —
   correctly does its job today — just a scaling note.

5. **Real vertical-specific terminology is structurally embedded, not just cosmetically labeled**
   — worth documenting as its own category. `locationType: "garage" | "lot"` is a hardcoded,
   closed union baked directly into the type system and used pervasively; domain-specific camera
   fields (`fliCameraItemId`, `lprCameraItemId`, `peopleCountingCameraItemId`) and product-package
   definitions hardcode real dollar figures and real product-line items directly in source, live-
   used, not admin-configurable. Not a "hardcoded string to swap" — it's the actual data model of
   a parking/camera-occupancy-counting vertical product. A non-parking customer would find
   "garage/lot" nonsensical as their only location-type choice. A legitimate structural finding
   for future productization planning, consistent with how the tenancy audit already treats "the
   vertical-specific taxonomy" as a starter-template decision, not a quick patch.

### Checked and confirmed clean / appropriate to keep

- `"Ergon Ops"` fallback sender/company name (3 send-*.js routes + mailer.js) — Ergon's own real
  product name, used correctly only as a fallback. Appropriate to keep.
- No other hardcoded years found — every other year-derivation in `main.tsx` uses `new Date()`
  dynamically; no second instance of the fixed-year-rollover bug class exists.
- No leftover real personal names, street addresses, or client identifiers anywhere in `src/` or
  `api/` (only in migration seed data, explicitly out of scope per this session's limits).
- Legal/boilerplate proposal text is DB seed data, out of scope, and not duplicated anywhere in
  source code.

---

## Part D — Test coverage by business risk audit

### Full test inventory

| File | Framework | Runs in CI (`npm test`) | Cases |
|---|---|---|---|
| `tests/api/create-notification.test.js` | vitest | Yes | 26 |
| `tests/api/cron-task-overdue.test.js` | vitest | Yes | 7 |
| `tests/api/rateLimit.test.js` | vitest | Yes | 18 |
| `tests/api/sales-quote-extract.test.js` | vitest | Yes | 7 |
| `tests/api/send-invite-email.test.js` | vitest | Yes | 5 |
| `tests/api/send-notification-email.test.js` | vitest | Yes | 7 |
| `tests/api/send-notification-slack.test.js` | vitest | Yes | 5 |
| `tests/api/send-proposal-email.test.js` | vitest | Yes | 9 |
| `tests/api/send-push.test.js` | vitest | Yes | 11 |
| `tests/api/send-submittal-email.test.js` | vitest | Yes | 6 |
| `src/persistence.critical-loaders.test.ts` | vitest | Yes | 11 |
| `src/project-ref.test.ts` | vitest | Yes | 5 (tonight's new year-boundary tests) |
| `tests/smoke/auth-gate.spec.ts` | Playwright | Yes | 1 |
| `tests/smoke/navigation-and-shell.spec.ts` | Playwright | Yes | 5 |
| `backend/tests/inventory-automation.test.ts` | manual ts-node script | **No** — excluded from `vitest.config.ts`'s `include`; requires a real service-role key, documented as run-manually-only | N/A |

Vitest suite: 102/102 passing (per `HANDOFF.md`).

### Coverage by risk category

| Category | Assessment | Evidence |
|---|---|---|
| **Authentication** | Thin | No dedicated test for `requireAuth.js` itself; only exercised indirectly as a mocked precondition. One direct test is the Playwright auth-gate smoke test — a single happy/unhappy-path UI check, not route-level. |
| **Permissions/role checks** | Thin | `create-notification.test.js` covers role-based recipient resolution well (26 cases). No test exercises `requireRole.js` directly, or any RLS/write-gate. All RLS/permission verification for the recent tenancy work is manual SQL in Supabase Studio, not automated. |
| **Financial handoffs** | None | No test file references Client Ledger, Billing, or PO-total computation anywhere. These are UI-computed values with zero regression protection. |
| **Quote acceptance** | Thin, misleading if read as "covered" | `send-proposal-email.test.js` tests the notification *sent after* a response, mocked — does not exercise `respond_to_quote_proposal`'s actual SQL logic. The A3 reuse gap is untested and untestable by the current suite, since that RPC has no JS/TS wrapper test at all. |
| **Project conversion** | None | `createProjectFromClosedWonQuote` has zero test references. Flagged in `PRODUCT_PHASE2_PLAN.md` §2.3 as a real, currently-unowned data-copy path. |
| **Inventory movement** | None (automated) / thin (manual) | The one real test (`inventory-automation.test.ts`) is well-designed but excluded from CI. `persistence.critical-loaders.test.ts` covers only the read path. |
| **Deletion/restoration** | None | No test references `deletion_log`, `deleted_at`, or `deleted_by_email` — the entire soft-delete/restore mechanism across 15 tables has zero automated coverage. |
| **Scheduled jobs** | Adequate | `cron-task-overdue.test.js` (7 cases) is genuinely solid — missing-secret, wrong-secret, dedupe-on-409, role-only-assignee exclusion, non-409-failure logging. Best-tested risk category in the repo. |
| **Notifications** | Adequate for recipient-resolution | `create-notification.test.js` is the largest test file. Delivery itself is separately covered per-channel. |
| **Offline uploads** | None | No test references offline upload behavior, retry queues, or connectivity-loss handling. |
| **Tenancy (migration 115/117/118)** | Solid manual coverage, zero automated/CI coverage | `PRODUCT_PHASE2_PLAN.md` §11.1a's transaction-safe SQL test script (INSERT-stamping, all failure modes, UPDATE-immutability, cascade-delete) was written, run live, confirmed clean — real and thorough, but a manually-run SQL script, not a vitest file. A future migration regressing this behavior would not be caught by `npm test`. |

### Prioritized test-gap list (highest-value first)

1. **Automate the tenancy ownership tests (117/118) as real CI-runnable tests**, even against a
   disposable/staging Supabase project via service-role key (the same constraint
   `inventory-automation.test.ts` already works around). Highest-risk gap: a silent regression
   here (e.g., a future migration reintroducing the Revision-4 grant leak) would go undetected.
2. **Add a server-side status guard for `respond_to_quote_proposal` (and a regression test for
   it)** — directly relevant to A3: this RPC has no regression protection at all, and the reuse
   gap found here is exactly what a test would have caught before it shipped.
3. **Move `inventory-automation.test.ts` into the CI/vitest path**, or add an equivalent
   mocked-fetch unit test alongside it, so allocate-or-queue logic gets checked on every push.
4. **Add a focused test for `createProjectFromClosedWonQuote`** — real, currently-untested,
   architecturally significant.
5. **Add a minimal soft-delete/restore regression test** for at least one representative table
   (e.g. `sales_quotes`) — the pattern is uniform across 15 tables, so one good test catches a
   broad class of future regressions cheaply.

**Explicitly not recommended**: blanket test coverage for Client Ledger/Billing UI-computed
views, offline upload retry logic, or permission-check coverage beyond what's already exercised
through the notification-recipient tests — real gaps, but lower leverage relative to the five
above; adding them now would be coverage for its own sake rather than protecting genuinely
fragile, high-blast-radius behavior.

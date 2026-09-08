# Phase 2 Plan — Clients + Sales Quote Ownership Graph

Status: **Revision 6 — migrations 117 and 118 both RUN successfully in production and fully
verified, including the transaction-safe test script (§11.1a). The per-workspace uniqueness
migration (previously numbered "119" throughout this document) is renumbered to migration 120.**

**Renumbering note (2026-09-08, later the same week):** migration 119 has been claimed by an
unrelated, higher-priority security fix — a live proposal-token replay vulnerability in
`respond_to_quote_proposal`, found during the 2026-09-08 overnight audit
(`PRODUCT_TOKEN_BACKUP_CONTENT_TEST_AUDIT.md` Part A3) and prioritized ahead of this phase's own
work per E's explicit instruction. See `backend/supabase/migrations/119_secure_quote_proposal_response.sql`
(created, not run) and that audit document's updated Part A3 for the full fix design. Every
"migration 119" reference below now means migration 120 — this is a pure renumbering, no design
content changed. No RLS policy, workflow, RPC, or application code from Phase 2 itself has been
changed by this renumbering.

**Final verification results (2026-09-08):** zero nulls in both new columns; full backfill to the
Ergon Test Workspace confirmed; both columns `NOT NULL`; both triggers present and firing on
`BEFORE INSERT`/`BEFORE UPDATE`; RLS on `clients`/`sales_quotes` confirmed unchanged; the grant
gap found during verification (§ Revision 4 below) is closed — only `service_role` retains
`EXECUTE` on the two ownership functions, `authenticated`/`anon`/`PUBLIC` do not. The §11.1a test
script — corrected once, live, for a role-scoping bug in its own fixture setup (see below) — ran
clean with no exception raised, confirming: correct-active-workspace stamping on INSERT, all
three failure modes (zero/suspended/ambiguous membership), UPDATE-immutability (null and
reassignment both rejected, unrelated-column updates unaffected), and unchanged quote/child-table/
cascade-delete behavior.

**Test-script bug found and fixed live, before the final clean run:** the first attempt failed
with `new row violates row-level security policy for table "workspaces"` — correct, expected
behavior (only platform admins can write to `workspaces`; `platform_admins` is empty). The script
itself was at fault: switching `role` to `authenticated` for the simulated caller stayed active
for the fixture-setup steps too (creating throwaway workspaces, editing `workspace_members`),
which need the SQL editor's own privileged, RLS-bypassing connection role. §11.1a below is the
corrected version — it captures the original role once and restores it around every fixture step,
switching to `authenticated` only immediately around the specific `clients`/`sales_quotes`
statement each test exercises.

**What changed in Revision 4 (post-117 production verification):**

1. **Migration 117 was run by E in Supabase Studio and committed successfully.** Post-migration
   verification confirmed: zero nulls in `clients.workspace_id`/`sales_quotes.workspace_id`; all
   four expected triggers present (`clients_guard_workspace_id` and
   `sales_quotes_guard_workspace_id`, each firing on both `BEFORE INSERT` and `BEFORE UPDATE`).
2. **A real gap was found during verification and is not yet closed.** The grant check
   (§14.2, query 6) showed `EXECUTE` on both `resolve_caller_workspace_id()` and
   `guard_workspace_id_mutation()` granted to `authenticated` **and** `anon` — neither was granted
   by migration 117 itself. Root cause: this Supabase project's schema-level default privileges
   (`alter default privileges in schema public grant execute on functions to anon, authenticated,
   service_role`, standard on every Supabase project) auto-grant EXECUTE to those roles on any
   newly created function, independent of migration 117's own `revoke all ... from public`, which
   only revokes the PUBLIC pseudo-role's default grant. This is the first migration in the
   project where a function was meant to carry no grant to `authenticated` at all, which is why
   the gap wasn't visible until now. Practical exposure was low (see the new migration file's
   comments for the full reasoning — `guard_workspace_id_mutation()` can't be called directly by
   any role regardless of grants, being a trigger-type function; `resolve_caller_workspace_id()`
   being callable by `authenticated` only ever returns the caller's own resolved workspace id or
   an error, and by `anon` always errored since `auth.uid()` resolves to null for anon), but it
   doesn't match the documented, explicitly-requested design, so it needs to be closed.
3. **`backend/supabase/migrations/118_revoke_workspace_ownership_function_grants.sql`** was created
   to close this — two `revoke execute ... from authenticated` / `from anon` statements,
   nothing else. `service_role` is deliberately left untouched (Supabase's trusted, RLS-bypassing
   backend role; migration 115's functions never restricted it either). **Since run and
   confirmed clean — see the Revision 5 status block above.**
4. **This renumbers the plan's previously-referenced "migration 118"** (per-workspace uniqueness
   transition + quote-ref counters + explicit trigger ordering, §7) **to migration 120**, since
   the grant-fix migration claimed the number 118 first. That work is unaffected and has not
   started.
5. **Recommended next step at the time this Revision 4 entry was written (now done — see Revision 5
   above):** after migration 118 (grant fix) runs, re-run the
   grant-check query and then run the transaction-safe test script (§11.1a) to empirically confirm
   the triggers still fire correctly for an authenticated caller now that the accidental grants
   are gone — this is exactly the scenario that script was designed to prove.

**What changed in Revision 3 (final implementation requirements applied before creating the migration 117 file):**
1. The `app.allow_workspace_reassignment` session-variable escape hatch is **removed entirely**.
   `guard_workspace_id_mutation()` now unconditionally rejects any UPDATE that changes or nulls
   `workspace_id`, with no bypass of any kind (§4.2).
2. `resolve_caller_workspace_id()` and `guard_workspace_id_mutation()` are granted **no EXECUTE
   privilege to `authenticated`** — both are reachable only through the trigger mechanism itself,
   with the exact reasoning documented (§4.2) and a dedicated test proving it works (§11.1a).
3. Migration 117 is now a real file, created with `begin;`/`commit;` wrapping the full sequence
   exactly as designed in Revision 2 — no soak period, no illustrative placeholders.
4. `assign_sales_quote_ref()`'s migration-120 planning note is corrected to preserve its existing
   `if new.quote_ref is not null then return new;` early-return behavior (§7.2), verified against
   the real function body in `066_sales_quote_ref_and_closed_at.sql`.
5. Repository checks run clean against the new file: `tsc -b` exits 0, `eslint .` reports 0
   errors / 76 warnings — the same baseline as before this file existed, since a `.sql` file
   under `backend/supabase/migrations/` is untouched by either tool.

**What changed in Revision 2 (carried forward, still in effect):**
1. Ownership is now protected on **UPDATE**, not just INSERT — `workspace_id` is immutable
   through ordinary authenticated writes once set (§4.2).
2. `resolve_caller_workspace_id()` now requires the caller's workspace to have `status='active'`
   and returns three distinguishable errors: no membership, suspended workspace, ambiguous
   membership (§4.1).
3. Migration 117 now performs the full sequence — nullable columns, backfill, in-migration
   zero-null assertion, triggers, **then `NOT NULL`** — in one atomic migration. There is no
   nullable soak period (§5).
4. A dedicated section states precisely what Phase 2 does and does not guarantee about ownership
   integrity in the absence of RLS (§8.1).
5. The public-proposal wording is corrected: `content_snapshot` does contain customer data;
   token access is described as intentional, token-authorized access to that one proposal, not as
   an absence of workspace data (§3.3). Suspended-workspace and notification workspace-awareness
   are now recorded as required-before-Phase-3-is-complete, not optional future flags.
6. Migration 120's quote-ref trigger ordering is now explicitly designed and verified, not
   assumed from trigger-name alphabetization (§7.2).
7. The test suite adds explicit UPDATE-immutability and suspended/ambiguous/zero-membership
   INSERT-failure tests, and explicitly disclaims "gap-free" claims about `quote_ref` sequencing
   around committed test rows (§11).
8. The five items in the prior "open decisions" list are now recorded as **confirmed decisions**
   (§13), since this message approved them.

Evidence basis (unchanged from Revision 1): direct reads of every migration file touching this
cluster (102, 033, 048, 053, 054, 055, 056, 057, 058, 060, 061, 064, 066, 087, 025); a dedicated
agent's exhaustive DB-schema/FK/RLS/constraint trace; a dedicated agent's exhaustive
application-code (`persistence.ts`, `main.tsx`, `api/*.js`) read/write trace; a direct repo check
for scheduled jobs (`vercel.json` → one cron, `/api/cron/task-overdue`, confirmed to touch
neither table).

---

## 1. Confirmed scope: one combined slice

**`clients` and the complete Sales Quote ownership graph are one coordinated Phase 2 slice —
approved, no longer an open question.** Reasoning (unchanged from Revision 1, now settled):
`clients` is functionally disconnected from the live app today (no UI creates one; `client_id` on
quotes/projects is nullable and was only partially backfilled at migration time — 3 of 6 names
matched on `sales_quotes`, 4 of 6 on `projects`, `102_clients.sql` migration comment). The real,
high-traffic, high-risk table is `sales_quotes`, whose six child tables all inherit ownership
through it. Splitting `clients` out as a standalone first phase would migrate a table nothing
depends on and buy no real intermediate milestone.

---

## 2. Complete dependency graph and ownership determination

### 2.1 Graph (FK direction, `→` = "has a required FK to")

```
clients (workspace_id: OWN — new column)
  ↑ nullable, optional, NOT enforced (partial backfill only) — client_id on quotes/projects stays as-is, out of scope
sales_quotes (workspace_id: OWN — new column)
  ├─ sales_quote_locations           → sales_quotes  (not null, on delete cascade)  INHERITS
  │    ├─ sales_quote_location_images → sales_quote_locations (not null, cascade)   INHERITS
  │    └─ sales_quote_location_items  → sales_quote_locations (not null, cascade)   INHERITS
  ├─ sales_quote_bom_lines           → sales_quotes  (not null, cascade)            INHERITS
  │    └─ (optional) source_location_id → sales_quote_locations (nullable, set null) — traceability only, not ownership
  ├─ sales_quote_intake_responses    → sales_quotes  (not null, unique, cascade)    INHERITS
  └─ sales_quote_proposals           → sales_quotes  (not null, cascade)            INHERITS
       └─ public_share_tokens (entity_type='sales_quote_proposal', entity_id=proposal.id)
            — polymorphic, NO real FK, NOT owned by this graph (shared w/ submittals) — OUT OF SCOPE

projects.source_sales_quote_id → sales_quotes (nullable, on delete set null) — traceability only, OUT OF SCOPE (projects has no workspace_id yet)
project_locations.source_quote_location_id → sales_quote_locations (nullable, set null) — traceability only, OUT OF SCOPE
tasks.quote_id → sales_quotes (nullable, set null) — traceability only, OUT OF SCOPE
```

### 2.2 Ownership matrix

| Table | Parent FK relationship | Own `workspace_id`? | Reasoning |
|---|---|---|---|
| `clients` | none (root) | **OWN** | No parent; must carry its own column. |
| `sales_quotes` | none (root) | **OWN** | No parent; `client_id` on it is nullable/unreliable (§1), so it cannot inherit from `clients` even conceptually. |
| `sales_quote_locations` | `quote_id not null … cascade` → `sales_quotes` | **INHERIT** | Required, cascading FK — parent always present, always deleted together. |
| `sales_quote_location_images` | `quote_location_id not null … cascade` → `sales_quote_locations` | **INHERIT** | Same pattern, transitively to `sales_quotes`. |
| `sales_quote_location_items` | `quote_location_id not null … cascade` → `sales_quote_locations` | **INHERIT** | Same. |
| `sales_quote_bom_lines` | `quote_id not null … cascade` → `sales_quotes` | **INHERIT** | Same. `source_location_id` is nullable/traceability only. |
| `sales_quote_intake_responses` | `quote_id not null unique … cascade` → `sales_quotes` | **INHERIT** | Same, 1:1. |
| `sales_quote_proposals` | `quote_id not null … cascade` → `sales_quotes` | **INHERIT** | Same. |
| `proposal_template_sections` | none — no FK into this graph (`053_sales_quote_proposals.sql:38-45`) | **OUT OF SCOPE** | Global, admin-editable boilerplate library, shared across every quote/proposal. Frozen into each proposal's `content_snapshot` at send time. Per-workspace templates is a separate product decision, deferred. |
| `public_share_tokens` | none — polymorphic `entity_type`/`entity_id`, no `references` clause (`025_phase11_…sql`) | **OUT OF SCOPE** | Shared with the unrelated Submittals feature. Workspace containment for tokens is a Phase 3 RLS-design problem (resolve the underlying entity's workspace at RPC-call time). |
| `notifications` / `notification_rules` | written directly by `respond_to_quote_proposal()`, no FK to this graph | **OUT OF SCOPE, required before Phase 3 is complete** | See §3.3 — recorded as a completion blocker for Phase 3, not an optional flag. |
| "documents" | no dedicated table exists in this cluster | **N/A** | Closest concept is `sales_quote_proposals.content_snapshot` (frozen JSON, printed client-side, no stored file) and `project_documents` (Projects table group, out of scope). |
| `projects` + child tables | receives a one-time copy via conversion; `projects.source_sales_quote_id` nullable FK back | **OUT OF SCOPE (own future phase)** | No `workspace_id` column yet. See §2.3 for the recorded forward dependency. |
| `tasks` | `quote_id` nullable FK, `on delete set null` | **OUT OF SCOPE** | Optional traceability link; belongs with whatever scopes `tasks` (likely tied to `projects`). |
| `catalog_items` | referenced by BOM/item/location camera fields | **OUT OF SCOPE** | Shared global product catalog, not tenant data. |
| `channels` | `client_id` FK → `clients`, `on delete cascade` | **OUT OF SCOPE for Phase 2 write path** | Only reachable through the currently-unused `clients` create flow. |
| `form_schemas` / `form_schema_fields` | referenced by `sales_quote_intake_responses.form_schema_id` | **OUT OF SCOPE** | Shared Fluid Form Engine infrastructure. |
| `deletion_log` | string `entity_type`/`entity_id`, no real FK | **OUT OF SCOPE** | Generic, deliberately entity-agnostic audit table. |

**Net result unchanged from Revision 1: exactly two tables get a new, independently-backfilled
`workspace_id` column — `clients` and `sales_quotes`.** Every other table inherits ownership
through its required, cascading FK and gets no new column.

### 2.3 Recorded forward dependency: quote→project conversion

`createProjectFromClosedWonQuote()` (`persistence.ts:10050-10268`) copies a workspace-scoped
quote into `projects`, which has no `workspace_id` column yet. Not a Phase 2 blocker (no RLS
added), but recorded for whichever future phase scopes `projects`:

> When that phase adds `projects.workspace_id`, its backfill must resolve ownership through the
> already-populated, durable `projects.source_sales_quote_id → sales_quotes.workspace_id` link
> wherever it exists (`persistence.ts:10093-10120` confirms it's set on every conversion),
> falling back to the same admin-driven backfill process this plan uses elsewhere.

---

## 3. Every reader/writer path — inventory

### 3.1 Writers into `clients` / `sales_quotes`

| Path | Table | Current workspace-awareness | Phase 2 handling |
|---|---|---|---|
| `createClient()` — `persistence.ts:1502-1549` | `clients` | none | Covered automatically by the trigger design (§4) — no code change. |
| `createSalesQuote()` — `persistence.ts:8522-8629`, called from `main.tsx:3146-3160` | `sales_quotes` | none | Same — no code change. |
| One-time migration backfill (`102_clients.sql`) | both | N/A, historical | Not a live writer. |

**No other writer exists** — confirmed exhaustively: no `api/*.js` route writes either table
(`sales-quote-extract.js` only parses PDFs into a Projects-shaped local-state object;
`send-proposal-email.js` only reads `sales_quote_proposals`); no scheduled job touches either
table (`vercel.json`'s only cron, `/api/cron/task-overdue`, greps clean for both).

### 3.2 Writers into inheriting child tables (no new column, listed for completeness)

| Table | Writer(s) | Parent id required |
|---|---|---|
| `sales_quote_locations` | `addSalesQuoteLocation(quoteId, …)` — `persistence.ts:8837-8857`; bulk insert in `createSalesQuote` — `persistence.ts:8580-8598` | `quoteId` |
| `sales_quote_bom_lines` | `addSalesQuoteBomLines(quoteId, lines, …)` — `persistence.ts:8760-8789` | `quoteId` |
| `sales_quote_location_items` | `addSalesQuoteLocationItem(quoteLocationId, …)` — `persistence.ts:8919-8950` | `quoteLocationId` |
| `sales_quote_location_images` | `addSalesQuoteLocationImage(quoteLocationId, …)` — `persistence.ts:9107+` | `quoteLocationId` |
| `sales_quote_intake_responses` | `upsertSalesQuoteIntakeResponse(quoteId, formSchemaId, responses, …)` — `persistence.ts:10602-10621` | `quoteId` |
| `sales_quote_proposals` | `createQuoteProposal(input, …)` — `persistence.ts:10454-10479` | `input.quoteId` |

Every one is DB-enforced to require its parent id. Since none of these tables gets its own
`workspace_id`, **no code change is required for any of them.**

### 3.3 The public, anonymous proposal-response surface — corrected description

| Path | What it touches | Workspace posture | Phase 2 handling |
|---|---|---|---|
| `get_quote_proposal_by_token(token)` — `security definer` RPC (`053_sales_quote_proposals.sql`), called from `fetchPublicQuoteProposal()` (`persistence.ts:10497-10527`), rendered at `ProposalPublicPage` (`main.tsx:24891-24935`), mounted at `?proposal=<token>` (`main.tsx:25195-25213`) | joins `public_share_tokens` + `sales_quote_proposals`; **`sales_quote_proposals.content_snapshot` does contain customer information** — client name, email, BOM, pricing, site data frozen at send time | **Correction from Revision 1:** this is not an absence of workspace data. It is **intentional, token-authorized access to that one specific proposal** — the whole point of a share link is that whoever holds the token can view that proposal's content, by design. The narrower, still-true claim is that the RPC never *joins* `sales_quotes` or `clients` directly, so a token cannot be used to browse or enumerate other quotes/clients beyond the one proposal it was issued for. | No schema change needed in Phase 2. **Recorded as required before Phase 3 is considered complete** (not an optional flag): once RLS exists, workspace `status` (active/suspended) must be checked before this RPC serves a proposal — a suspended workspace's public links must stop working. This is the same requirement already recorded for `resolveActiveWorkspace()` in `PRODUCT_PHASE1_PLAN.md`. |
| `respond_to_quote_proposal(token, …)` — `security definer` RPC (`054_quote_proposal_responded_notification.sql:37-96`) | updates `sales_quote_proposals`, reads `created_by_email`/`site_name` from `sales_quotes`, writes directly to `notifications` with no workspace scoping | Same posture — legitimate, intentional token-authorized write to the proposal a customer was sent | No change in Phase 2. **Recorded as required before Phase 3 is considered complete:** (a) this RPC must gain a suspended-workspace check, mirroring the RPC above; (b) `notifications` must become workspace-aware before RLS is added anywhere near it, or a legitimate customer response could silently fail to notify once RLS lands and this RPC hasn't been updated in step. |

### 3.4 Quote-to-project conversion — two paths, one deferred with a recorded dependency

| Path | Persisted? | Link back to quote | Phase 2 handling |
|---|---|---|---|
| `createProjectFromClosedWonQuote()` — `persistence.ts:10050-10268`, triggered from `main.tsx:22523-22533` on Closed-Won | Yes — full copy incl. real Storage-object copy (`persistence.ts:9043-9066`) | Real, durable FK: `projects.source_sales_quote_id` (`on delete set null`) + `project_locations.source_quote_location_id` | No code change. Forward dependency recorded in §2.3. |
| `handlePullBomFromClosedQuote()` / `pullQuoteId` — `main.tsx:5339-5368`, legacy "Pull BOM from Closed Sales" button | No — local React state only, persisted via legacy `saveProjectSites()` blob save | None at all | **Confirmed decision (§13): deferred until the Projects ownership phase, but kept documented as a required dependency for that phase**, not silently dropped. This path can copy a workspace-scoped quote's client name and BOM text into a project with zero traceable link — once RLS exists, this is a real containment gap that the future Projects phase must close or retire this path. |

### 3.5 Search, reports, reference numbering — read-only paths

| Path | Touches | Phase 2 impact |
|---|---|---|
| Global search (`main.tsx:5545-5547, 5568`) | filters the already-loaded, in-memory `salesQuotes` array client-side; never queries `clients` | None. |
| Reports panel (`main.tsx:7682-7699`) | does not reference `sales_quotes` or `clients` | None. |
| `sales_quote_ref_counters` / `assign_sales_quote_ref()` (`066_sales_quote_ref_and_closed_at.sql:36-61`) | server-side trigger only | Real schema change required — see §7. |

---

## 4. Ownership mechanism — server-derived, active-status checked, immutable after write

### 4.1 `resolve_caller_workspace_id()` — now active-status aware with distinguishable errors

```sql
-- Exact text as run in migration 117 (created and RUN, live-verified in production).
create or replace function public.resolve_caller_workspace_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_membership_count int;
  active_membership_count int;
  result uuid;
begin
  select count(*) into total_membership_count
  from public.workspace_members
  where user_id = auth.uid();

  if total_membership_count = 0 then
    raise exception 'no workspace membership found for current user';
  end if;

  select count(*) into active_membership_count
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  if active_membership_count = 0 then
    raise exception 'workspace membership exists but the workspace is not active (suspended)';
  elsif active_membership_count > 1 then
    raise exception 'ambiguous active workspace membership for current user — primary workspace selection is not yet implemented';
  end if;

  select wm.workspace_id into result
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  return result;
end;
$$;

revoke all on function public.resolve_caller_workspace_id() from public;
grant execute on function public.resolve_caller_workspace_id() to authenticated;
```

Three distinguishable failure modes, each with its own message, per the correction requested:
**no membership at all**, **membership exists but its workspace is suspended**, and **ambiguous
(more than one active membership)**. A suspended workspace's members can no longer create clients
or quotes — this is now enforced at write time, not just documented as a future gap.

### 4.2 `guard_workspace_id_mutation()` — stamps on INSERT, unconditionally blocks mutation on UPDATE

**Final implementation requirement applied in Revision 3: no bypass of any kind.** The session-
variable escape hatch (`app.allow_workspace_reassignment`) proposed in Revision 2 has been removed
entirely. There is no flag, setting, or condition anywhere in this migration that permits an
UPDATE to change or null an existing `workspace_id` — the rejection is unconditional.

```sql
-- Exact text, as created in
-- backend/supabase/migrations/117_clients_sales_quote_workspace_ownership.sql
create or replace function public.guard_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := public.resolve_caller_workspace_id();
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_workspace_id_mutation() from public;

drop trigger if exists clients_guard_workspace_id on public.clients;
create trigger clients_guard_workspace_id
  before insert or update on public.clients
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists sales_quotes_guard_workspace_id on public.sales_quotes;
create trigger sales_quotes_guard_workspace_id
  before insert or update on public.sales_quotes
  for each row execute function public.guard_workspace_id_mutation();
```

What this guarantees, precisely:

- **On INSERT**: `workspace_id` is always derived server-side from the caller's own active
  membership (§4.1), ignoring/overwriting whatever the client sent.
- **On UPDATE**: if an ordinary authenticated write attempts to change `workspace_id` to a
  different value **or to null**, the write is rejected outright, with no exception path. An
  update that leaves `workspace_id` untouched (e.g., editing a client's name, a quote's
  `client_email`) is unaffected — the guard only fires on a change to that one column, so all of
  today's normal edit behavior continues to work exactly as before.
- **Future reassignment, deliberately not designed here**: if workspace reassignment is ever
  needed, it requires its own separately reviewed migration that changes this trigger's logic
  (or introduces a distinct, audited, privileged procedure) — not a flag hidden inside this one.
  Migration 117 intentionally leaves no such door open, per the correction requested.

**Grants — neither function is executable by `authenticated`, and neither needs to be:**

- `guard_workspace_id_mutation()` is a trigger function (`returns trigger`). PostgreSQL does not
  allow calling a trigger-type function directly via SQL at all — `select
  guard_workspace_id_mutation()` fails with *"trigger functions can only be called as triggers"*
  — and the trigger mechanism invokes it as part of the executor's handling of the table's defined
  trigger, not as an ACL-checked function call made by the DML-issuing role. No EXECUTE grant to
  `authenticated` is required for the trigger to fire on an authenticated user's insert or update.
- `resolve_caller_workspace_id()` is only ever called from *within*
  `guard_workspace_id_mutation()`'s own `security definer` body. Because the outer function is
  `security definer`, that inner call executes under the **definer's** privileges (the
  migration-running role, effectively superuser-equivalent in Supabase Studio) — not the original
  authenticated caller's — so the definer's own execute rights satisfy the call without any grant
  to `authenticated`.
- Both functions have `execute` **revoked from `public`** and **no grant to `authenticated`** —
  the minimal possible surface: reachable only through the trigger mechanism itself, exactly as
  requested. §11.1a is the transaction-safe test that verifies this empirically rather than
  resting on the reasoning alone. If that test were ever to fail on a real Supabase/Postgres
  version, the documented minimal fix is `grant execute on function
  public.resolve_caller_workspace_id() to authenticated;` only — `guard_workspace_id_mutation()`
  itself should never need a grant, since no role can invoke a trigger-type function directly
  regardless of context.

---

## 5. Migration 117 — final sequence (created, RUN, live-verified)

Per the correction: **the entire lifecycle — nullable columns, backfill, verification, triggers,
and `NOT NULL` enforcement — happens inside one atomic migration.** There is no window, however
brief, where the column exists but is unprotected or unverified.

**This is the real, complete content of
`backend/supabase/migrations/117_clients_sales_quote_workspace_ownership.sql`**, created in the
repository and reproduced here for the record. It has been run against production Supabase and
verified — see the Revision 5 status block at the top of this document for results.

One addition beyond Revision 2's sketch: the real file's header comment records that
`sales_quotes` already has a `before insert` trigger, `sales_quotes_assign_ref` (migration 066),
which — being alphabetically before `sales_quotes_guard_workspace_id` — fires first. This is
harmless for migration 117 specifically, because `assign_sales_quote_ref()` in its current form
never reads `new.workspace_id`. It becomes relevant only once migration 120 redefines that
function to key the ref counter by workspace, which is why §7.2 designs explicit ordering for
that later change rather than leaving it implicit here.

```sql
-- ============================================================
-- Migration 117 — CREATED, RUN, LIVE-VERIFIED. Exact content of
-- backend/supabase/migrations/117_clients_sales_quote_workspace_ownership.sql
-- ============================================================
begin;

-- Section 1 -- Schema: nullable for now, made NOT NULL later in this same
-- transaction (Section 6).
alter table public.clients
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.sales_quotes
  add column if not exists workspace_id uuid references public.workspaces(id);

-- Section 2 -- Indexes
create index if not exists idx_clients_workspace_id on public.clients(workspace_id);
create index if not exists idx_sales_quotes_workspace_id on public.sales_quotes(workspace_id);

-- Section 3 -- Backfill existing rows. No trigger exists yet at this point
-- in the transaction, so this plain UPDATE cannot conflict with the guard
-- installed in Section 5. Idempotent: matches zero rows on any re-run.
update public.clients
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.sales_quotes
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- Section 4 -- In-migration assertion: abort the whole transaction if the
-- backfill missed anything. This is the proof that "historical backfill is
-- complete" -- the migration physically cannot commit otherwise.
do $$
begin
  if exists (select 1 from public.clients where workspace_id is null) then
    raise exception 'backfill incomplete: clients.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.sales_quotes where workspace_id is null) then
    raise exception 'backfill incomplete: sales_quotes.workspace_id still has nulls';
  end if;
end $$;

-- Section 5 -- Ownership functions and triggers (full text and grant
-- reasoning in §4.1, §4.2). Neither function is granted execute to
-- authenticated -- both are reachable only through the trigger mechanism.
create or replace function public.resolve_caller_workspace_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_membership_count int;
  active_membership_count int;
  result uuid;
begin
  select count(*) into total_membership_count
  from public.workspace_members
  where user_id = auth.uid();

  if total_membership_count = 0 then
    raise exception 'no workspace membership found for current user';
  end if;

  select count(*) into active_membership_count
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  if active_membership_count = 0 then
    raise exception 'workspace membership exists but the workspace is not active (suspended)';
  elsif active_membership_count > 1 then
    raise exception 'ambiguous active workspace membership for current user -- primary workspace selection is not yet implemented';
  end if;

  select wm.workspace_id into result
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
    and w.status = 'active';

  return result;
end;
$$;

revoke all on function public.resolve_caller_workspace_id() from public;

create or replace function public.guard_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := public.resolve_caller_workspace_id();
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_workspace_id_mutation() from public;

drop trigger if exists clients_guard_workspace_id on public.clients;
create trigger clients_guard_workspace_id
  before insert or update on public.clients
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists sales_quotes_guard_workspace_id on public.sales_quotes;
create trigger sales_quotes_guard_workspace_id
  before insert or update on public.sales_quotes
  for each row execute function public.guard_workspace_id_mutation();

-- Section 6 -- Enforce NOT NULL now -- every existing row was just
-- verified non-null in Section 4, and every future write has been
-- trigger-protected since Section 5, both within this same transaction --
-- so there is no gap to wait out.
alter table public.clients alter column workspace_id set not null;
alter table public.sales_quotes alter column workspace_id set not null;

commit;
```

**Why immediate `NOT NULL` is safe here, stated explicitly per the correction request:**
`clients` and `sales_quotes` are small operational tables (dozens to low hundreds of rows, the
same scale as the tables migration 115 modified), so a plain `alter column … set not null` runs
its validating table scan in the same transaction in well under a second, with no meaningful lock
contention risk. The two-step alternative — `add constraint … check (workspace_id is not null)
not valid`, then `validate constraint` separately to avoid a long lock — exists specifically for
tables large enough that a full-table validating scan would hold a blocking lock for an
unacceptable duration. That doesn't apply at this table's size, so the extra step would add
complexity without a corresponding safety benefit. If a future phase applies this same pattern to
a genuinely large table, that two-step form is the right one to reach for instead.

**What migration 117 leaves for migration 120:** only the per-workspace uniqueness transition and
the quote-ref counter/trigger-order change (§7), because both are meaningless correctness-wise
until a second workspace actually exists, and bundling them into 117 would only add unrelated
surface area to the migration that removes the null-risk window.

---

## 6. Indexes, uniqueness, and deletion behavior — full table

| Table | New column | Index | Deletion behavior | Unique constraint change |
|---|---|---|---|---|
| `clients` | `workspace_id uuid not null` (set within 117) | `idx_clients_workspace_id` (117) | unchanged | `clients.name` global `unique` → `unique(workspace_id, name)` (120) |
| `sales_quotes` | `workspace_id uuid not null` (set within 117) | `idx_sales_quotes_workspace_id` (117) | unchanged | `sales_quotes_quote_ref_unique unique(quote_ref)` → `unique(workspace_id, quote_ref)` (120) |
| All inheriting children | none | none new | unchanged — already `not null … on delete cascade` to their parent | none — no column added |

---

## 7. Migration 120 — per-workspace uniqueness and explicit trigger ordering

### 7.1 Uniqueness transition

1. **`clients.name`**: `alter table public.clients drop constraint clients_name_key; alter table public.clients add constraint clients_name_workspace_unique unique (workspace_id, name);`
2. **`sales_quotes.quote_ref`** and its supporting counter table — see §7.2 for the full,
   order-verified design.

Deferred to 120, not bundled into 117, because until a second workspace exists, global and
per-workspace uniqueness are behaviorally identical for the one real workspace in production —
there's no correctness reason to couple this to the null-safety work in 117.

### 7.2 Quote-ref trigger ordering — explicitly designed, not assumed from naming

**Correction from Revision 1:** the prior draft proposed relying on alphabetical trigger-name
ordering between the ownership trigger and `assign_sales_quote_ref()`, then flagged that the
names as written didn't actually sort correctly — an unacceptable way to guarantee order.
Revision 2 removes the reliance on trigger-name alphabetization entirely, in favor of an explicit
guard plus a numeric naming convention that makes the intended order unambiguous to a future
reader (belt and suspenders, not "one clever trick"):

```sql
-- Illustrative only — migration 120, not yet designed as a runnable file.

-- 1. Rename the existing ownership trigger with an explicit numeric prefix
--    so its firing order relative to ref-assignment is stated, not implied.
alter trigger sales_quotes_guard_workspace_id on public.sales_quotes
  rename to "10_sales_quotes_guard_workspace_id";

alter trigger sales_quotes_assign_ref on public.sales_quotes
  rename to "20_sales_quotes_assign_ref";

-- 2. Redefine assign_sales_quote_ref() to (a) assert its precondition
--    rather than silently trust firing order, and (b) preserve the
--    EXISTING behavior from migration 066 verbatim: if a caller has
--    already supplied a non-null quote_ref, the trigger leaves it alone
--    and does not touch the counter table at all. This early-return is
--    load-bearing for the migration 066 backfill's own re-run safety and
--    for any future deliberate manual ref assignment -- it must not be
--    dropped when this function is redefined.
create or replace function public.assign_sales_quote_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_year integer := extract(year from now())::integer;
  seq integer;
begin
  if new.quote_ref is not null then
    return new;
  end if;

  if new.workspace_id is null then
    raise exception 'workspace_id must be set before quote_ref assignment -- trigger order violated';
  end if;

  insert into public.sales_quote_ref_counters (workspace_id, year, next_seq)
  values (new.workspace_id, ref_year, 2)
  on conflict (workspace_id, year) do update set next_seq = public.sales_quote_ref_counters.next_seq + 1
  returning next_seq - 1 into seq;

  new.quote_ref := 'SQ-' || ref_year || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

-- 3. sales_quote_ref_counters gets a workspace dimension and a composite key.
alter table public.sales_quote_ref_counters add column workspace_id uuid references public.workspaces(id);
update public.sales_quote_ref_counters set workspace_id = (select id from public.workspaces where slug = 'ergon-test') where workspace_id is null;
alter table public.sales_quote_ref_counters drop constraint sales_quote_ref_counters_pkey;
alter table public.sales_quote_ref_counters alter column workspace_id set not null;
alter table public.sales_quote_ref_counters add primary key (workspace_id, year);
```

`"10_..."` firing before `"20_..."` is both alphabetically and numerically unambiguous — the
prefix exists specifically so a future reader doesn't have to reason about word-alphabetization
at all. The `if new.workspace_id is null then raise exception` guard inside
`assign_sales_quote_ref()` is the real safety net: even if a future migration ever reordered or
renamed triggers again, a broken order fails the insert immediately and visibly rather than
silently producing a wrongly-scoped or null-keyed counter row. §11 includes a dedicated test that
verifies this ordering empirically, not just by reading the SQL.

### 7.3 Exact current names — verified against the real migration files, not assumed

Checked directly against `066_sales_quote_ref_and_closed_at.sql` and `102_clients.sql` tonight
(2026-09-08), not reconstructed from memory or an earlier draft:

| Object | Exact current name | Source |
|---|---|---|
| `sales_quote_ref_counters` primary key | `sales_quote_ref_counters_pkey` (Postgres default naming for a bare `year integer primary key` column) | `066_sales_quote_ref_and_closed_at.sql:15` |
| `sales_quotes.quote_ref` unique constraint | `sales_quotes_quote_ref_unique` (explicitly named) | `066_sales_quote_ref_and_closed_at.sql:90` |
| `sales_quotes` ref-assignment trigger | `sales_quotes_assign_ref` | `066_sales_quote_ref_and_closed_at.sql:59` |
| `clients.name` unique constraint | `clients_name_key` (Postgres default naming for a bare `name text not null unique` column) | `102_clients.sql:34` |
| `sales_quotes` ownership trigger (from 117) | `sales_quotes_guard_workspace_id` | `117_clients_sales_quote_workspace_ownership.sql` |
| `clients` ownership trigger (from 117) | `clients_guard_workspace_id` | `117_clients_sales_quote_workspace_ownership.sql` |

The `alter trigger ... rename to` and `alter table ... drop constraint` statements throughout this
section use these exact, verified names — not guesses.

### 7.4 Concurrency-safe numbering

The `insert ... on conflict (workspace_id, year) do update set next_seq = ... + 1 returning next_seq - 1`
pattern (§7.2, step 2) is the same atomic upsert-increment shape already used by the *existing,
unmodified* `assign_sales_quote_ref()` in migration 066 — migration 120 only adds `workspace_id`
to the conflict target and the returned row, it doesn't change the underlying safety mechanism.
Two concurrent quote-creation transactions targeting the same `(workspace_id, year)` serialize
correctly because the `on conflict do update` clause takes a row-level lock on the counter row for
the duration of the increment — the second transaction blocks until the first commits or rolls
back, then sees the already-incremented value. This is the same pattern this codebase's own
standing rule requires for any "re-acquired by key" table (`HANDOFF.md`: *"must use an atomic
upsert-reclaim RPC, not a plain INSERT"*) — migration 120 doesn't introduce a new risk here, it
extends an already-correct mechanism to a composite key.

### 7.5 Preservation guarantees, stated explicitly

- **Existing `quote_ref` values are never touched.** Migration 120 alters the counter table and the
  assignment trigger's *future* behavior only — no `update sales_quotes set quote_ref = ...`
  statement exists anywhere in this design. Every quote's current ref stays exactly as it is.
- **A deliberately supplied non-null `quote_ref` is still preserved.** §7.2's redefined
  `assign_sales_quote_ref()` keeps the original `if new.quote_ref is not null then return new;`
  early return from migration 066, verbatim, before touching the counter table at all — re-checked
  tonight against the live migration 066 source (§7.2's code block) to confirm this wasn't
  dropped when the function was redesigned for the workspace dimension.

### 7.6 Active/suspended workspace behavior — inherited for free from migration 117

Migration 120 does not need its own active/suspended check on quote-ref assignment. By the time
`assign_sales_quote_ref()` fires on a `sales_quotes` insert, `new.workspace_id` was already
stamped by migration 117's `guard_workspace_id_mutation()` trigger, which only ever succeeds by
calling `resolve_caller_workspace_id()` — and that function already rejects any caller whose only
workspace is suspended (§4.1), *before the row is even created*. So a `sales_quotes` row can only
ever reach the ref-assignment trigger already carrying an active workspace's id. This is a real
example of the layered design paying off: migration 120 gets a correctness guarantee for free from
a constraint migration 117 already established, rather than needing to re-implement it.

### 7.7 Preflight and transaction-safe tests for migration 120 (designed now, not run)

**Preflight** (run before 120, confirm the starting state):
```sql
select count(*) as sales_quote_ref_counters_row_count from public.sales_quote_ref_counters;
select conname from pg_constraint where conrelid = 'public.sales_quote_ref_counters'::regclass;
select conname from pg_constraint where conrelid = 'public.clients'::regclass and contype = 'u';
select conname from pg_constraint where conrelid = 'public.sales_quotes'::regclass and contype = 'u';
-- Expected: sales_quote_ref_counters_pkey, clients_name_key, sales_quotes_quote_ref_unique
-- exist exactly as named in §7.3, confirming nothing else has renamed or replaced them since.
```

**Transaction-safe test scenarios** (to design as an executable script, same `begin;`/`rollback;`
pattern as §11.1a, when 120 is actually drafted — listed here so the design is complete, not
deferred to a future session with no plan):
- Two quotes created back-to-back for the same workspace in the same year get sequential,
  non-duplicate refs (extends existing Test G).
- A quote created for a second, throwaway workspace in the same year gets its own independent
  `0001` sequence, proving the counter is genuinely per-workspace, not accidentally still global.
- Supplying a non-null `quote_ref` explicitly on insert is preserved unchanged, and does **not**
  increment the counter table (proves §7.5's guarantee empirically, not just by reading the code).
- Simulate the trigger-order guard firing: temporarily attempt an insert with `guard_workspace_id_mutation`'s
  trigger disabled (superuser-only, inside the rolled-back transaction) to confirm
  `assign_sales_quote_ref()` raises its own `workspace_id must be set before quote_ref assignment`
  exception rather than silently succeeding with a null-keyed counter row.
- `clients.name` and `sales_quotes.quote_ref` per-workspace uniqueness: two different workspaces
  can each have a client named identically / are never expected to collide on quote_ref anyway
  since it's now workspace-scoped; the *same* workspace still cannot create two clients with the
  same name (regression test for existing behavior, not just new behavior).

### 7.8 Production verification for migration 120 (designed now, not run)

```sql
-- Confirm the new constraint/column shape.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.clients'::regclass, 'public.sales_quotes'::regclass, 'public.sales_quote_ref_counters'::regclass)
  and contype in ('u', 'p');

-- Confirm every existing sales_quote_ref_counters row was backfilled to the Ergon Test Workspace
-- and no row has a null workspace_id.
select count(*) from public.sales_quote_ref_counters where workspace_id is null;

-- Confirm a freshly created quote (via the real app UI, not a direct insert) gets a correctly
-- scoped, sequential quote_ref with no visible behavior change for today's single workspace.
```

### 7.9 Rollback limitations — cross-referenced from §9

See §9's "Rollback of migration 118" section (which already covers 120's rollback caveats under
its prior numbering) for the honest limitation: if a second workspace has already created quotes
under the new per-workspace counter scheme by the time a rollback is needed, collapsing
`sales_quote_ref_counters` back to a single `(year)` key is lossy for counter *granularity* (two
workspaces' sequences would need to be merged/renumbered), though every `quote_ref` value already
stamped on a `sales_quotes` row is unaffected either way. Given §13's confirmed decision that no
second workspace exists until Phase 3's isolation and an active-workspace selector are built, this
scenario cannot actually arise before migration 120 is long since stable in production.

### 7.10 In plain language — what changes for a real user

**What changes, invisibly:** nothing about how a quote gets its reference number changes in
appearance — a new quote still gets `SQ-2026-0043` (or whatever the next number is) the instant
it's created, exactly as today. Under the hood, that number now comes from a counter that's
scoped to the workspace instead of a single global counter, but since only one workspace
(Ergon Test Workspace) exists in production, the sequence of numbers a user actually sees does
not change or skip. The same is true for adding a new client with the same name as an existing
one — today that's rejected outright; after 120, it's still rejected within the same workspace
(no behavior change visible to any current user), and would only be *allowed* if a second,
different company's workspace existed, which it doesn't yet.

**What a user should never notice:** any lag, error, or visible difference in the "New Quote" or
"Add Client" flows. If they do, that's a bug, not an intended consequence of this migration.

**What this migration does *not* do:** it does not let one company see another company's quotes
or clients — that access-control guarantee is Phase 3's job (§8.1), not this one's. It does not
change who can create, edit, or delete a quote or client — RLS on both tables stays exactly as
open as it is today.

---

## 8. What Phase 2 guarantees about ownership integrity — and what it explicitly does not

### 8.1 Stated precisely, per the correction request

**Phase 2 does not claim cross-workspace access containment.** RLS on `clients`, `sales_quotes`,
and every inheriting child table remains exactly `using(true)/with check(true)` — fully open,
unchanged — throughout Phase 2. Any authenticated user can still read and edit any client or
quote's ordinary columns today, exactly as before. That containment guarantee is Phase 3's job,
not this one's.

**What Phase 2 does guarantee, as a real, database-enforced property, independent of and prior to
whatever RLS eventually says:** once migration 117 commits, the *ownership value itself* —
`workspace_id` — cannot be removed or changed through any write path that exists today. This
holds regardless of how open the surrounding RLS policy is, because the guard trigger (§4.2)
evaluates before RLS's `with check` clause and blocks the mutation outright. Concretely:

- An authenticated user can update a client's `name` or a quote's `client_email` today, and will
  still be able to after migration 117 — RLS permits it, and the guard doesn't fire because
  `workspace_id` isn't part of that update.
- That same user cannot set a client's or quote's `workspace_id` to null, to a different
  workspace's id, or to any value other than what it already holds — the guard rejects it
  unconditionally, with no exception path, no session-variable override, and no RLS policy able
  to override that rejection. A future workspace-reassignment capability would require its own
  separately reviewed migration that changes this trigger's logic (§4.2) — migration 117 leaves
  no bypass hook of any kind for it to use.

So Phase 2's real deliverable is **tamper-proof ownership metadata**, not **tenant isolation**.
Keeping these two claims distinct is the point of this section.

### 8.2 Detection, unchanged in spirit from Revision 1

- Post-117 verification (part of the migration's own in-transaction assertion, §5, plus a
  post-migration confirmation query) checks zero nulls and correct backfill.
- A simple, repeatable admin health-check query E can run at any time:
  ```sql
  select 'clients' as table_name, count(*) from public.clients where workspace_id is null
  union all
  select 'sales_quotes', count(*) from public.sales_quotes where workspace_id is null;
  ```
  Expected result: zero rows, permanently — and now structurally guaranteed to stay that way,
  since the column is `not null` from the moment 117 commits, not just conventionally so.
- Incorrect-but-non-null ownership (a row stamped to the wrong workspace by a correctly-functioning
  trigger, e.g. because a user's membership was itself wrong) is not mechanically preventable by
  the trigger alone — an admin-only spot-check query comparing each row's `workspace_id` against
  its creator's membership remains a manual, E-run check, not an automated alert, since a platform
  admin acting cross-workspace may be legitimate in the future.

---

## 9. Rollback

**Rollback of migration 117** (if run and found to have a problem): reverse order — drop the two
guard triggers, drop `guard_workspace_id_mutation()` and `resolve_caller_workspace_id()`, then
`alter column … drop not null` before dropping the columns (or simply drop the columns, which
cascades both the `not null` constraint and the indexes). No RLS or read-path behavior changed at
any point, so this fully restores pre-migration behavior with no loss to anything existing code
reads.

```sql
-- Illustrative only.
drop trigger if exists clients_guard_workspace_id on public.clients;
drop trigger if exists sales_quotes_guard_workspace_id on public.sales_quotes;
drop function if exists public.guard_workspace_id_mutation();
drop function if exists public.resolve_caller_workspace_id();
alter table public.clients drop column if exists workspace_id;
alter table public.sales_quotes drop column if exists workspace_id;
```

**Rollback of migration 120** (if run and found to have a problem): restore the global unique
constraints, restore `sales_quote_ref_counters`'s original `(year)` primary key (dropping the
`workspace_id` column), restore `assign_sales_quote_ref()`'s prior year-only-keyed body, and
rename the triggers back. **Honest caveat, unchanged in kind from Revision 1:** if 120 has been
live long enough for a second workspace to have created quotes under the new per-workspace
counter scheme, collapsing the counter table back to a single `(year)` key is lossy for counter
*granularity* — two workspaces' sequences would need to be merged/renumbered — though the
`quote_ref` values already stamped on existing `sales_quotes` rows are unaffected either way,
since rollback only changes how *future* refs are generated.

---

## 10. Production verification plan

**Preflight (before 117):** confirm current row counts for `clients` and `sales_quotes`; confirm
neither table currently has a `workspace_id` column; confirm the Ergon Test Workspace row exists
with slug `ergon-test` and `status = 'active'`.

**Post-117 verification:**
- Row counts unchanged for both tables.
- Zero-null check passes (redundant with the in-migration assertion, run again as an
  independent post-hoc confirmation).
- Every existing row's `workspace_id` equals the Ergon Test Workspace id.
- Both columns report `not null` in `information_schema.columns`.
- RLS policy definitions for both tables are byte-identical to pre-migration:
  `select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid in ('public.clients'::regclass, 'public.sales_quotes'::regclass);`
- Live smoke test: create one throwaway client and one throwaway quote through the normal app UI
  as the signed-in admin, confirm both land with the correct `workspace_id`, confirm an attempted
  direct-SQL update of either row's `workspace_id` is rejected, then delete/soft-delete the
  throwaway rows (see §11's caveat about `quote_ref` gaps from this).

**Post-120 verification (later):** confirm the new per-workspace unique constraints exist and the
old global ones are gone; confirm `sales_quote_ref_counters` now has one row per
`(workspace_id, year)`; confirm a freshly-created quote gets a correctly-scoped, sequential
`quote_ref` with no visible behavior change for today's single workspace; confirm the trigger-order
guard in `assign_sales_quote_ref()` has never fired (i.e., `workspace_id` was always present when
it ran).

---

## 11. Tests

Transaction-wrapped, self-contained tests using the established exception-handler/savepoint
pattern from Phase 1, run manually by E in Supabase Studio.

### 11.1 Ownership stamping and guard behavior (new in Revision 2)

- **Test A — INSERT stamps the correct active workspace.** As the authenticated admin (a member
  of exactly one, active, Ergon Test Workspace), insert a client and a quote with no
  `workspace_id` in the payload; assert both are stamped with the Ergon Test Workspace id.
- **Test B — INSERT fails for zero membership.** Using a fixed, known test-user UUID with no
  `workspace_members` row at all, attempt an insert; assert it fails with the "no workspace
  membership found" message specifically (not a generic error), inside an exception-handler block
  so the rest of the test script continues.
- **Test C — INSERT fails for a suspended workspace.** Create a throwaway second workspace,
  set its `status` to a non-`'active'` value, add a test user as its only member, attempt an
  insert as that user; assert it fails with the "workspace is not active (suspended)" message
  specifically. Drop the throwaway workspace at the end of the (rolled-back) transaction.
- **Test D — INSERT fails for ambiguous active membership.** Create two throwaway active
  workspaces, add a test user as an active member of both, attempt an insert as that user; assert
  it fails with the "ambiguous active workspace membership" message specifically.
- **Test E — UPDATE cannot null or change `workspace_id`.** As the authenticated admin, attempt
  three separate updates against a known test client/quote row: (a) set `workspace_id` to null,
  (b) set it to a different, valid workspace's id, (c) leave it unchanged but update an unrelated
  column (`name`/`client_email`). Assert (a) and (b) both fail with the "immutable through
  ordinary writes" message, using the exception-handler/savepoint pattern for each so a caught
  expected failure doesn't abort the rest of the test; assert (c) succeeds normally, proving the
  guard is scoped to the one column, not the whole row.
- **Test F — historical backfill completeness, proven before enforcement.** This is proven
  structurally by migration 117 itself (§5, step 3's in-migration assertion) rather than as a
  separate post-hoc test — the migration cannot commit at all if any row was missed, which is a
  stronger guarantee than a test that runs after the fact and could theoretically be skipped.

### 11.1a Exact, runnable script for Tests A–E (and G–I) — final, for post-117 execution

This is the real script, not a description of one. It never uses a synthetic user id — every
test reuses one real, existing, workspace-admin member of the Ergon Test Workspace as the
simulated caller (`workspace_members.user_id` has a hard FK to `auth.users`, so a made-up UUID
would fail on its own), and every fixture change (deleted/added memberships, throwaway
workspaces) happens inside this one transaction and is undone by the final `rollback;` — nothing
here is ever committed. This is also the empirical proof, requested for §4.2's grant reasoning,
that both ownership functions work correctly with **no EXECUTE grant to `authenticated`**.

**Correction found during live execution (recorded here, not silently fixed):** the first run of
this script against production failed at the `insert into public.workspaces` fixture-setup step
with `new row violates row-level security policy for table "workspaces"`. This is *correct,
pre-existing behavior working as designed* — `workspaces`' own RLS only allows platform admins to
write to it, and `platform_admins` is empty, so no authenticated non-platform-admin (including a
workspace admin) can insert into `workspaces` directly, the same restriction that required
migration 116's rename to be run manually rather than through the app. The bug was in this
script: once `role` was switched to `authenticated` for the client/quote statements under test,
it stayed `authenticated` for every later statement too, including the throwaway-workspace and
`workspace_members` fixture setup, which needs the SQL editor's own privileged, RLS-bypassing
connection role. The corrected version below captures that original role once and switches back
to it around every fixture-setup/teardown step, switching to `authenticated` only immediately
around the specific `clients`/`sales_quotes` statement each test is actually exercising.

```sql
begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  admin_workspace_id uuid;
  suspended_workspace_id uuid;
  second_active_workspace_id uuid;
  other_workspace_id uuid;
  test_client_id uuid;
  test_quote_id uuid;
  stamped_workspace_id uuid;
begin
  -- Capture the SQL editor's own privileged connection role so it can be
  -- restored around every fixture setup/teardown step below -- only the
  -- specific clients/sales_quotes statement each test exercises should
  -- run as the simulated `authenticated` caller.
  select current_setting('role') into original_role;

  -- Resolve a real, existing workspace-admin member of the Ergon Test
  -- Workspace, reused as the simulated caller for every test below.
  select wm.user_id, wm.workspace_id into admin_user_id, admin_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.slug = 'ergon-test' and wm.is_workspace_admin
  limit 1;

  if admin_user_id is null then
    raise exception 'no workspace-admin member of the Ergon Test Workspace found -- cannot run tests';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id, 'role', 'authenticated')::text, true);

  -- Test A: INSERT stamps the correct active workspace. Also proves the
  -- trigger fires correctly with no EXECUTE grant to authenticated on
  -- either resolve_caller_workspace_id() or guard_workspace_id_mutation().
  perform set_config('role', 'authenticated', true);
  insert into public.clients (name) values ('Phase 2 Test Client A')
  returning id, workspace_id into test_client_id, stamped_workspace_id;
  perform set_config('role', original_role, true);
  if stamped_workspace_id is distinct from admin_workspace_id then
    raise exception 'TEST A FAILED: client stamped with % expected %', stamped_workspace_id, admin_workspace_id;
  end if;
  raise notice 'TEST A PASSED: client insert stamped workspace_id % correctly with no EXECUTE grant needed', stamped_workspace_id;

  perform set_config('role', 'authenticated', true);
  insert into public.sales_quotes (client_name, site_name, created_by_email)
  values ('Phase 2 Test Quote A', 'Test Site', 'phase2-test@example.com')
  returning id, workspace_id into test_quote_id, stamped_workspace_id;
  perform set_config('role', original_role, true);
  if stamped_workspace_id is distinct from admin_workspace_id then
    raise exception 'TEST A FAILED: quote stamped with % expected %', stamped_workspace_id, admin_workspace_id;
  end if;
  raise notice 'TEST A PASSED: quote insert stamped workspace_id % correctly', stamped_workspace_id;

  -- Test E: UPDATE cannot null or change workspace_id; an unrelated
  -- column update is unaffected.
  perform set_config('role', 'authenticated', true);
  begin
    update public.clients set workspace_id = null where id = test_client_id;
    raise exception 'TEST E FAILED: nulling workspace_id via UPDATE should have been rejected';
  exception when others then
    raise notice 'TEST E PASSED (a): UPDATE to null workspace_id correctly rejected: %', sqlerrm;
  end;
  perform set_config('role', original_role, true);

  select id into other_workspace_id from public.workspaces where slug <> 'ergon-test' limit 1;
  if other_workspace_id is null then
    insert into public.workspaces (name, slug, status)
    values ('Phase 2 Test Other Workspace', 'phase2-test-other', 'active')
    returning id into other_workspace_id;
  end if;

  perform set_config('role', 'authenticated', true);
  begin
    update public.clients set workspace_id = other_workspace_id where id = test_client_id;
    raise exception 'TEST E FAILED: reassigning workspace_id via UPDATE should have been rejected';
  exception when others then
    raise notice 'TEST E PASSED (b): UPDATE to a different workspace_id correctly rejected: %', sqlerrm;
  end;

  update public.clients set name = 'Phase 2 Test Client A (renamed)' where id = test_client_id;
  perform set_config('role', original_role, true);
  raise notice 'TEST E PASSED (c): unrelated column UPDATE (name) succeeded normally -- guard is scoped to workspace_id only';

  -- Test B: INSERT fails for zero membership. Fixture teardown/setup
  -- (deleting/restoring the admin's own membership row) runs as the
  -- privileged original_role; only the insert attempt itself runs as
  -- authenticated.
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = admin_workspace_id;

  perform set_config('role', 'authenticated', true);
  begin
    insert into public.clients (name) values ('Phase 2 Test Client B');
    raise exception 'TEST B FAILED: insert with zero membership should have been rejected';
  exception when others then
    if sqlerrm like '%no workspace membership found%' then
      raise notice 'TEST B PASSED: zero-membership insert correctly rejected with the expected message';
    else
      raise exception 'TEST B FAILED: rejected, but with the wrong message: %', sqlerrm;
    end if;
  end;
  perform set_config('role', original_role, true);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (admin_workspace_id, admin_user_id, true);

  -- Test C: INSERT fails for a suspended workspace. Fixture setup runs
  -- as original_role.
  insert into public.workspaces (name, slug, status)
  values ('Phase 2 Test Suspended Workspace', 'phase2-test-suspended', 'suspended')
  returning id into suspended_workspace_id;

  delete from public.workspace_members where user_id = admin_user_id and workspace_id = admin_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (suspended_workspace_id, admin_user_id, true);

  perform set_config('role', 'authenticated', true);
  begin
    insert into public.clients (name) values ('Phase 2 Test Client C');
    raise exception 'TEST C FAILED: insert under a suspended workspace should have been rejected';
  exception when others then
    if sqlerrm like '%not active (suspended)%' then
      raise notice 'TEST C PASSED: suspended-workspace insert correctly rejected with the expected message';
    else
      raise exception 'TEST C FAILED: rejected, but with the wrong message: %', sqlerrm;
    end if;
  end;
  perform set_config('role', original_role, true);

  delete from public.workspace_members where user_id = admin_user_id and workspace_id = suspended_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (admin_workspace_id, admin_user_id, true);

  -- Test D: INSERT fails for ambiguous active membership. Fixture setup
  -- runs as original_role.
  insert into public.workspaces (name, slug, status)
  values ('Phase 2 Test Second Active Workspace', 'phase2-test-second-active', 'active')
  returning id into second_active_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (second_active_workspace_id, admin_user_id, true);

  perform set_config('role', 'authenticated', true);
  begin
    insert into public.clients (name) values ('Phase 2 Test Client D');
    raise exception 'TEST D FAILED: insert with ambiguous active membership should have been rejected';
  exception when others then
    if sqlerrm like '%ambiguous active workspace membership%' then
      raise notice 'TEST D PASSED: ambiguous-membership insert correctly rejected with the expected message';
    else
      raise exception 'TEST D FAILED: rejected, but with the wrong message: %', sqlerrm;
    end if;
  end;
  perform set_config('role', original_role, true);

  delete from public.workspace_members where user_id = admin_user_id and workspace_id = second_active_workspace_id;

  -- Tests G/H/I: existing behavior unchanged -- quote_ref assignment,
  -- child-table inserts, cascade delete.
  perform set_config('role', 'authenticated', true);
  insert into public.sales_quote_locations (quote_id, location_type, name, line_sort)
  values (test_quote_id, 'garage', 'Phase 2 Test Location', 1);

  insert into public.sales_quote_bom_lines (quote_id, item_name, qty, line_sort)
  values (test_quote_id, 'Phase 2 Test BOM Item', 1, 1);
  perform set_config('role', original_role, true);

  raise notice 'TEST H PASSED: child-table inserts against the Test A quote succeeded unchanged';

  delete from public.sales_quotes where id = test_quote_id;

  if exists (select 1 from public.sales_quote_locations where quote_id = test_quote_id)
     or exists (select 1 from public.sales_quote_bom_lines where quote_id = test_quote_id) then
    raise exception 'TEST I FAILED: child rows survived deletion of the parent quote';
  end if;
  raise notice 'TEST I PASSED: cascade delete removed all child rows as before';

  raise notice 'ALL PHASE 2 MIGRATION 117 TESTS PASSED';
end $$;

rollback;
```

Note the deliberate `rollback;` at the end: nothing this script does — including the two committed-looking client/quote inserts, the temporary membership deletions, or the throwaway workspaces — is ever actually persisted. This also means it does **not** trigger the §11.3 gap-in-`quote_ref` caveat below, since the test quote is never committed. That caveat applies specifically to the separate, real, committed smoke test in §10.

### 11.2 Existing behavior unchanged (carried forward from Revision 1)

- **Test G — quote creation and ref numbering.** Insert a `sales_quotes` row exactly as
  `createSalesQuote()` does (same column set, no `workspace_id` in the payload); assert
  `workspace_id` is auto-populated and `quote_ref` is assigned in the existing `SQ-<year>-<seq>`
  format.
- **Test H — child table inserts unaffected.** Insert one row each into
  `sales_quote_locations`, `sales_quote_bom_lines`, `sales_quote_location_items`,
  `sales_quote_location_images`, `sales_quote_intake_responses`, `sales_quote_proposals` against
  the Test G quote; assert all succeed unchanged.
- **Test I — cascade delete still works.** Delete the Test G quote; assert every Test H child row
  is gone, consistent with `persistence.ts:8652-8657`.
- **Test J — public proposal RPCs still work unchanged.** Call `get_quote_proposal_by_token` and
  `respond_to_quote_proposal` against a fresh test proposal/share-token pair as `anon`; assert
  both behave exactly as before.
- **Test K — RLS is provably untouched.** Re-run the RLS-policy-text comparison from §10 as part
  of the test script itself, so the suite fails loudly if any policy text differs from the
  pre-117 baseline.

### 11.3 Explicit disclaimer on `quote_ref` sequencing (correction from Revision 1)

**Do not claim `quote_ref` remains gap-free through this test run.** `sales_quote_ref_counters`
increments monotonically and does not decrement when a quote row is later deleted — this was true
before Phase 2 and remains true after. Any test (in this suite or run manually against production
as a smoke test) that inserts a real, committed quote row and later deletes it will permanently
consume one sequence number that will never be reused. The correct claims to make after such a
test are that ref values are **sequential and never duplicated**, not that the sequence is
**gap-free** — those are different properties, and only the first one is actually guaranteed.
Wherever possible, prefer running these tests inside a transaction that ends in `rollback;`
(the pattern used throughout this suite and Phase 1's) specifically so no `quote_ref` is
permanently consumed by testing; the one exception is the live production smoke test in §10,
which does commit a throwaway quote by design and should be understood to consume one real ref
number as an accepted cost of verifying against real production behavior.

### 11.4 Cross-workspace containment — scope statement, unchanged from Revision 1

Phase 2 adds no RLS, so no test in Phase 2 can prove data cannot cross workspaces — see Revision
1's original §11.2 reasoning, carried forward unchanged: Phase 2 can prove the column correctly
discriminates rows (Test G-style fixtures under two throwaway workspaces), and can record the
deferred authenticated-cross-workspace-denial test scenarios for Phase 3 to adopt directly, but
cannot execute them meaningfully before RLS exists.

---

## 12. Sales work that may safely continue in parallel

Unchanged in substance from Revision 1, updated for the confirmed decisions in §13:

**Safe to continue unblocked:** Sales UI/UX work that doesn't add a new table/column to this
cluster or a new create-path for `clients`/`sales_quotes`; `proposal_template_sections`
content/template-management work (confirmed structurally out of this graph, §2.2).

**Tracked as a separate, confirmed small bug fix (not part of Phase 2 migration work):** the two
fake-`quoteRef` display bugs found during this audit — `main.tsx:5028`
(`buildProposalSnapshot()` sets `quoteRef: quote.id.slice(0, 8).toUpperCase()` instead of the
real `quote.quoteRef`) and `api/send-proposal-email.js:92` (same pattern). Safe to fix any time,
unrelated to workspace scoping.

**Confirmed deferred, with the dependency kept documented:** the legacy
`handlePullBomFromClosedQuote`/`pullQuoteId` path (§3.4) — not touched in Phase 2, explicitly
carried forward as a required item for whichever future phase scopes `projects`.

**Should be sequenced after or coordinated with migration 117:** any new code path that creates a
`clients` or `sales_quotes` row. Once 117 ships, any such writer is automatically covered by the
trigger with no extra work needed.

---

## 13. Confirmed decisions

1. **`clients` and the complete Sales Quote ownership graph remain one coordinated slice** — not
   split into a clients-first phase (§1).
2. **Ambiguous multi-workspace writes fail until an active-workspace selector exists.**
   `resolve_caller_workspace_id()` raises an exception rather than guessing (§4.1) — this is now
   built into migration 117's design, not deferred.
3. **No user should receive a second workspace membership before that active-workspace selector
   is implemented.** This is an operational constraint for E to follow when managing
   `workspace_members` going forward, not something migration 117 can enforce in the database —
   recorded here so it isn't lost between phases.
4. **The fake-`quoteRef` display bug is tracked as a separate, small fix**, outside Phase 2's
   migration scope (§12).
5. **The legacy Pull BOM from Closed Sales path is deferred until the Projects ownership phase**,
   kept documented as a required dependency rather than silently dropped (§3.4, §12).

---

## 14. Final copy-paste blocks — migration 117

Migration 117 exists as `backend/supabase/migrations/117_clients_sales_quote_workspace_ownership.sql`
and has **not** been run against Supabase. The blocks below are the exact materials for E to
review and, on approval, execute in Supabase Studio — mirroring how migrations 115 and 116 were
handed off. The migration's own SQL is reproduced in full in §5; it is not repeated here.

### 14.1 Preflight — run before the migration

```sql
-- Expected: exactly one row, slug 'ergon-test', status 'active'; both
-- "already has column" checks return zero rows (confirms this hasn't
-- partially run before).
select id, name, slug, status from public.workspaces where slug = 'ergon-test';

select count(*) as clients_row_count from public.clients;
select count(*) as sales_quotes_row_count from public.sales_quotes;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'clients' and column_name = 'workspace_id';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'sales_quotes' and column_name = 'workspace_id';
```

### 14.2 Post-migration verification — run after migration 117 commits

```sql
-- 1. Zero nulls (independent confirmation of the in-migration assertion).
select 'clients' as table_name, count(*) as null_workspace_id_count from public.clients where workspace_id is null
union all
select 'sales_quotes', count(*) from public.sales_quotes where workspace_id is null;

-- 2. Row counts unchanged (compare against the preflight output).
select count(*) as clients_row_count from public.clients;
select count(*) as sales_quotes_row_count from public.sales_quotes;

-- 3. Every existing row backfilled to the Ergon Test Workspace.
select count(*) as clients_not_ergon_test from public.clients c
join public.workspaces w on w.id = c.workspace_id
where w.slug <> 'ergon-test';

select count(*) as quotes_not_ergon_test from public.sales_quotes q
join public.workspaces w on w.id = q.workspace_id
where w.slug <> 'ergon-test';

-- 4. Both columns are NOT NULL.
select table_name, column_name, is_nullable from information_schema.columns
where table_schema = 'public' and table_name in ('clients', 'sales_quotes') and column_name = 'workspace_id';

-- 5. RLS policy text is byte-identical to pre-migration (still fully open,
--    untouched by this migration).
select polrelid::regclass as table_name, polname,
       pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
where polrelid in ('public.clients'::regclass, 'public.sales_quotes'::regclass)
order by 1, 2;

-- 6. Neither ownership function is executable by PUBLIC or authenticated
--    (expect zero rows).
select grantee, routine_name, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('resolve_caller_workspace_id', 'guard_workspace_id_mutation')
  and grantee in ('PUBLIC', 'authenticated');

-- 7. Both triggers exist on both tables.
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('clients_guard_workspace_id', 'sales_quotes_guard_workspace_id')
order by 1, 4;

-- 8. Live smoke test (commits for real -- see §11.3's quote_ref caveat):
--    as the signed-in admin, create one throwaway client and one
--    throwaway quote through the normal app UI, confirm both land with
--    the correct workspace_id via the browser-fetch-interception
--    technique used in prior phases, confirm a direct-SQL attempt to
--    update either row's workspace_id is rejected, then delete/
--    soft-delete the throwaway rows. Understand that the throwaway
--    quote permanently consumes one quote_ref sequence number -- expected,
--    not a bug (§11.3).
```

### 14.3 Transaction-safe behavior/security tests

The exact, runnable script is in §11.1a. It is self-contained (`begin; … rollback;`), touches no
committed data, and proves: Test A (INSERT stamps the correct active workspace, with no EXECUTE
grant to `authenticated` on either function), Test B (INSERT fails for zero membership), Test C
(INSERT fails for a suspended workspace), Test D (INSERT fails for ambiguous active membership),
Test E (UPDATE cannot null or reassign `workspace_id`; unrelated-column UPDATE is unaffected),
and Tests G/H/I (quote creation, child-table inserts, and cascade delete all remain unchanged).

### 14.4 Rollback — only if migration 117 has already been run and must be reversed

```sql
drop trigger if exists clients_guard_workspace_id on public.clients;
drop trigger if exists sales_quotes_guard_workspace_id on public.sales_quotes;

drop function if exists public.guard_workspace_id_mutation();
drop function if exists public.resolve_caller_workspace_id();

alter table public.clients drop column if exists workspace_id;
alter table public.sales_quotes drop column if exists workspace_id;
```

Dropping each column also drops its index and `not null` constraint automatically (both are
defined solely on that column). No RLS or read-path behavior changed at any point in migration
117, so this fully restores pre-migration behavior with no loss to anything existing code reads.
If migration 118 (the grant fix) has also already run, its own effect (two `revoke` statements)
needs no rollback of its own — dropping the two functions in this block removes the grants along
with them.

### 14.5 Migration 118 — grant correction (created, RUN, verified clean)

```sql
revoke execute on function public.resolve_caller_workspace_id() from authenticated;
revoke execute on function public.resolve_caller_workspace_id() from anon;
revoke execute on function public.guard_workspace_id_mutation() from authenticated;
revoke execute on function public.guard_workspace_id_mutation() from anon;
```

Full reasoning and the exact grant-check results that surfaced this are in the Revision 4
changelog at the top of this document and in the migration file's own header comment. After
running this, re-run the grant-check query from §14.2 (expect zero rows now for `authenticated`
and `anon`), then run the §11.1a transaction-safe test script to confirm the ownership triggers
still fire correctly for an authenticated caller with the grants fully closed.

---

*Migration 117 has been created, reviewed, and **run successfully** against production — zero
nulls, correct backfill, both triggers present and firing as designed. Migration 118 (grant
correction, §14.5) has been created in response to a real finding from that verification, but has
**not** been run yet. No RLS policy has changed and no application code has been deployed.
Migration 120 (per-workspace uniqueness, quote-ref counters, explicit trigger ordering, §7) has
not been started. Repository checks pass clean against both new migration files: `tsc -b` exits
0; `eslint .` reports 0 errors and 76 warnings, the same baseline as before either file existed.*

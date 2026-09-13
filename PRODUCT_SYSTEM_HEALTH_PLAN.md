# System Health — Consolidated Implementation-Ready Design

Status: **DESIGN, CONSOLIDATED AND IMPLEMENTATION-READY. NOTHING BUILT.** No schema, no migration, no UI, no alert wiring exists for any of this. This document consolidates three prior passes scattered across `PRODUCT_ERROR_VISIBILITY_AUDIT.md` (§15 original spec, 2026-09-08; A2.3 design proposal; A2.4 refinement, 2026-09-11) into one buildable design, per the 2026-09-12 overnight reliability closeout. It does not introduce new decisions beyond what's already been made — see §9 for the one item still genuinely open. **Refined further for Queue B4 (`CONTINUOUS_CODER_HANDOFF.md`, 2026-09-12)**: added §10 (failure-in-the-monitor path, not previously specified) and expanded the old §10 into §11, a concrete migration/API/UI/test sequence with named functions, file locations, and per-step test coverage — no new decisions here either; §9/D8 (alert recipient/channel) remains the one explicitly open item, and no runnable migration exists until it is answered or E instructs proceeding without alert delivery.

Independent of Phase 3 RLS: this design's `workspace_id` column is nullable (null = infrastructure-wide event; set = tenant-scoped event) and every row is visible to any admin today, matching the temporary single-workspace posture used everywhere else in this app. Per-row workspace filtering is deferred to Phase 3, not a blocker to building this now.

## 1. What this tracks

- Failed scheduled/cron jobs and each job's last successful run.
- Redis connected/degraded state.
- Notification delivery failures (email, Slack, push) — `notification_deliveries` already exists and is written to; nothing currently reads it back anywhere in the UI (`PRODUCT_ERROR_VISIBILITY_AUDIT.md`, §10 finding, still open).
- Data-save failures already worth elevating beyond the browser console — every function this session's audits found with real `console.error` diagnostics but no durable record (the entire "still flagged unchecked" and "resolved locally, diagnostics only" populations in `PRODUCT_ERROR_VISIBILITY_AUDIT.md`, plus tonight's task-5 fixes).
- Backup/restore run outcomes (once the checkpointed-restore design in `PRODUCT_ERROR_VISIBILITY_AUDIT.md` §A2.2c / this session's HANDOFF entry is implemented — System Health is the natural place a failed or partial restore surfaces to an admin who wasn't watching).
- Database/RPC failures (a security-definer RPC raising an EC0xx code that isn't a routine user-input rejection — e.g. `EC008`/`active_workspace_id()` guard trips, which should never happen in normal operation and are themselves worth a health event).

## 2. Data model

```sql
-- Illustrative only -- column list/types to be re-verified against live
-- schema conventions (naming, timestamp types, etc.) at actual
-- implementation time, same discipline as every other migration in this
-- repo.
create table system_health_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id),  -- null = infrastructure-wide
  surface text not null,               -- e.g. 'notification_delivery', 'cron', 'redis', 'restore', 'rpc'
  entity_type text,                    -- e.g. 'purchase_order', 'project_bom_line' -- null if not entity-scoped
  entity_id uuid,
  failure_reason_code text not null,   -- stable code, e.g. an EC0xx or a named internal reason
  severity text not null check (severity in ('info', 'degraded', 'down')),
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  occurrence_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_by_email text,
  previous_occurrence_id uuid references system_health_events(id),
  safe_detail jsonb,                   -- redacted, safe-to-display technical detail (see §7)
  created_at timestamptz not null default now()
);

create unique index system_health_events_dedup_key
  on system_health_events (surface, coalesce(entity_type, ''), coalesce(entity_id, '00000000-0000-0000-0000-000000000000'), failure_reason_code)
  where status in ('active', 'acknowledged');
```

The partial unique index is what makes deduplication (§3) a plain upsert rather than application-level read-then-write logic.

## 3. Deduplication and lifecycle — DECIDED (A2.4, 2026-09-11)

- **Dedup key**: `(surface, entity_type, entity_id | null, failure_reason_code)`. A new event matching an existing **active or acknowledged** row's key increments `occurrence_count` and bumps `last_seen_at`, rather than creating a new row.
- **Lifecycle**: `active` → `acknowledged` → `resolved`. A `resolved` row that fails again creates a **new** row (linked via `previous_occurrence_id`), never a silent reopen — this is why the dedup index only covers `active`/`acknowledged` rows.
- **Alert-loop protection**: only the transition *into* `active` (a brand-new row, or a resolved row's fresh successor) fires a new alert. An occurrence-count increment on an already-alerted active row does not re-fire. A broken alert channel degrades to "silent until next login" via the System Health screen's own direct table read — never an infinite alert-about-the-alert loop.
- **Self-monitoring**: this table's own write path must be genuinely independent of what it monitors — specifically, if `notification_deliveries` writes start failing, that failure must be recorded through a path that does not itself depend on the notification-delivery pipeline. Concretely: `system_health_events` writes go through their own dedicated persistence function, never routed through `recordNotificationDelivery` or any other monitored write path.

## 4. Alert thresholds — DECIDED (§15 original spec)

- No alert on a single failure.
- `degraded` after 2 consecutive failures in a rolling window.
- `down` (and only then an admin alert) after 3 consecutive failures spanning ≥5 minutes.
- Security-sensitive events (e.g. rate-limit hits) never merge into the same alert stream as operational failures.
- One alert per surface per incident — not one per occurrence.
- Recovery is quiet/logged (the row transitions to `resolved`), not a push alert of its own.

## 5. Retry eligibility — DECIDED (A2.4)

Per-failure-type, not a blanket "Retry" button:
- **Retry-eligible** ("Retry now" shown): a single notification send, a cron job re-run — anything naturally idempotent and safely re-triggerable in isolation.
- **Not retry-eligible** (only "Acknowledge + link to that feature's own recovery flow" shown): anything inside a non-transactional multi-step write — e.g. one step of `restoreFullBackupSnapshot`, or a mid-sequence failure in `saveMovementsBuildsAllocations`. Retrying from this screen would not know how to resume correctly; the feature's own recovery flow (or, for restore specifically, the checkpoint/resume design in `PRODUCT_ERROR_VISIBILITY_AUDIT.md` §A2.2c) is the real fix path.

## 6. Retention — DECIDED (2026-09-11, E; `PRODUCT_ERROR_VISIBILITY_AUDIT.md` §A2.4 item 3)

- `resolved` rows keep full detail for **90 days** after `resolved_at`.
- After 90 days, rolled up into a **summarized count** (not deleted) and retained indefinitely at summary level — e.g. one row per `(surface, failure_reason_code, month)` with a total occurrence count, no per-event detail.
- `active`/`acknowledged` rows are **never** auto-deleted or summarized regardless of age — an old unresolved problem must never silently age out of view.

## 7. Safe diagnostic detail and redaction

- `safe_detail` (jsonb) holds whatever is safe to show an admin directly: HTTP status, a stable error code, a table/entity name, a row count. It must **never** contain: access tokens, session identifiers, raw request/response bodies from third-party APIs (email/Slack/push provider payloads can carry recipient PII), or a raw Postgres error message that might embed a constraint name revealing schema internals unnecessarily.
- The existing site-wide convention this app already uses everywhere (log full detail via `console.error`, surface only a plain message to the end user) is the same discipline that applies here: `safe_detail` is the ALREADY-redacted admin-safe version, not a raw passthrough of whatever `console.error` logged. Building the write helper that populates `system_health_events` is the one place this redaction rule must be enforced consistently — every call site should go through it rather than constructing `safe_detail` ad hoc.
- Raw error text, if ever needed for deep debugging, stays in Vercel's own function logs (already true today) — System Health is not a replacement for that, only a durable, admin-visible summary layer above it.

## 8. Admin-facing UI shape

One row per health event: what happened, who/what is affected, first-seen, most-recent, occurrence count, status, and a safe action (**Retry now** or **Acknowledge**, per §5) — raw technical detail behind a collapsed disclosure, not inline. Reuses the existing "Sync issue (N)" pill pattern already live in this app's header (extend it to cover every Critical-tier surface, not just today's device-recipe/inventory sync errors), plus a dedicated Admin → System Health panel listing every active/acknowledged event with filter-by-surface and filter-by-severity.

## 9. What remains genuinely open

Only one real open item, everything else above is settled:
- **Alert channel wiring**: this design reuses the existing email/Slack/Teams/push channels (§3's self-monitoring rule already covers why the *data path* must be independent), but which specific channel(s) fire for a `down` transition, and who receives them (all admins? a configurable on-call list?), has not been decided. Recommend: reuse whatever channel/recipient list is already configured for admin notifications today (if one exists — needs a quick trace at implementation time), rather than building a new notification-preferences UI just for this. Default if undecided: email to every workspace admin, since email is the one channel every admin account already has by construction (a real login).

## 10. Failure-in-the-monitor path

§3's "self-monitoring" rule already requires the write path to be independent of what it monitors;
this section specifies what happens when the monitor's **own** write fails — not addressed anywhere
above, and the one gap Queue B4 asked to be fully specified that the original design left implicit.

- **The write helper itself never throws to its caller.** `recordSystemHealthEvent` (server RPC side)
  and its frontend counterpart both swallow their own failure internally (`console.error` only) and
  return a plain success/failure boolean — a real business-logic write (the thing that *triggered*
  the health event in the first place) must never fail, retry, or roll back *because the health-event
  logging about it failed*. Logging the problem is strictly best-effort relative to the real
  operation.
- **A failed health-event write is itself logged**, once, to Vercel's function logs (already-true
  baseline logging, not a new mechanism) — this is the one case genuinely too meta to feed back into
  `system_health_events` (an insert-failure-into-the-failure-table has no safe place left to go) and
  is the explicit, deliberate exception to "every failure gets a durable record."
- **The read side (Admin → System Health panel) degrades to "last known good" on its own load
  failure**, using the exact same pattern already established for `loadInventoryItems`/etc. elsewhere
  in this app: show the last successfully loaded set with a plain "couldn't refresh — showing data
  from `<timestamp>`" banner, never a blank or crashed panel, and never silently claim "no active
  issues" when the real answer is "couldn't check."
- **The dedup upsert (§3) is the one write pattern here that must be idempotent under retry** — a
  network blip that causes the caller to re-send the same `(surface, entity_type, entity_id,
  failure_reason_code)` key must increment `occurrence_count` at most once for that actual event, not
  once per retry. Achieved for free by the partial unique index already in §2 plus an `on conflict`
  upsert, not a new mechanism — called out here explicitly so the implementation doesn't skip it.
- **The retention job (§11 step 4) failing** is itself worth one `system_health_events` row under its
  own `surface = 'system_health_retention'` — the one place this table is allowed, and expected, to
  monitor a job that operates on itself, since the retention job's failure mode (old detail rows never
  getting rolled up) is an ordinary, recoverable operational failure, not the same unrecoverable
  meta-failure case as the write-path failing entirely.

## 11. Build sequencing — migration/API/UI/test detail

Each step below stays a self-contained, reviewable batch, matching this repo's established delivery
discipline. Step 5 (alert wiring) is explicitly held until §9's channel question (D8) is answered, or
E instructs proceeding with steps 1–4 and no alert delivery at all — steps 1–4 are already fully
useful without it (an admin who checks the panel sees everything; they just don't get pushed to).

**Step 1 — Migration** (illustrative SQL only, not drafted as a runnable file; confirm the next free
migration number at execution time):
- `system_health_events` table (§2) + partial dedup unique index.
- `record_system_health_event(surface, entity_type, entity_id, failure_reason_code, severity,
  safe_detail)` — a single `security definer` SQL function performing the §3 dedup upsert
  (`insert ... on conflict (dedup key) where status in ('active','acknowledged') do update set
  occurrence_count = occurrence_count + 1, last_seen_at = now()`), callable from any other RPC.
  Follows the same `search_path=''`/fully-qualified hardening discipline as migration 124's bridge
  functions, since this is also a `security definer` function other RPCs will call internally.
- `acknowledge_system_health_event(id)` / `resolve_system_health_event(id)` — thin, role-gated
  (admin only, matching this table's existing "every row visible to any admin" posture) status
  transition functions, each recording `acknowledged_by_email`/`resolved_at`.
- Test script (transaction-safe, same convention as migrations 119–133): dedup upsert increments
  correctly on a matching key and creates a new row on a non-matching key; a `resolved` row's repeat
  failure creates a *new* row linked via `previous_occurrence_id`, never reopens the old one;
  `acknowledge`/`resolve` are admin-gated (a non-admin call is rejected); the partial index genuinely
  excludes `resolved` rows (confirmed by successfully inserting a "duplicate" key once the original is
  resolved).

**Step 2 — Frontend `recordSystemHealthEvent`** (`src/persistence.ts`), for client-observed failures
the RPC layer wouldn't see directly. Initial call sites, reusing `PRODUCT_ERROR_VISIBILITY_AUDIT.md`
§14's own ranked list rather than re-deriving a new one: `restoreFullBackupSnapshot`'s per-section
failures (§14 #1), the `notification_deliveries` write-failure path (§14 #5, once §10 of the audit
doc's own read-back gap is closed), cron job failures (§14 #6), and rate-limit hits (§14 #7). **Not**
every `console.error` call site in the codebase — only these already-identified, already-ranked ones;
expanding coverage beyond them is a separate, later decision, not part of this batch.
Test coverage: each call site's existing failure-path test (already present per
`PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md` for restore) gains an assertion that
`recordSystemHealthEvent` was called with the correct `surface`/`failure_reason_code`, using a mocked
implementation — not a live table write in a `.test.ts` file.

**Step 3 — Admin → System Health panel** (`src/main.tsx`, new `AdminPage` section). Read-only list +
Acknowledge/Retry actions per §5/§8; the header "Sync issue (N)" pill (already live) extended to
source its count from this table for Critical-tier surfaces, not just today's device-recipe/inventory
sync errors. Test coverage: rendering active vs. acknowledged vs. resolved rows, retry-eligible vs.
acknowledge-only action visibility per §5's per-failure-type rule, and the §10 "last known good on
load failure" degradation path.

**Step 4 — Retention job** (`api/cron/system-health-retention.js`, matching the existing
`api/cron/task-overdue` pattern and its dedupe-409-is-not-a-failure handling). Rolls `resolved` rows
older than 90 days into the monthly summary tier (§6); test coverage: a resolved row exactly at the
90-day boundary, an active/acknowledged row of any age is never touched, and the job's own failure
produces exactly one `system_health_events` row per §10's last bullet (not one per rolled-up row).

**Step 5 — Alert wiring** — held pending §9/D8. Once answered: a trigger (or the same
`record_system_health_event` function, extended) fires on transition-into-`active` only (§3's
alert-loop protection), routed through whatever channel/recipient D8 settles on. Test coverage:
exactly one alert per surface per incident (§4), no alert on an occurrence-count-only increment, no
alert on a quiet recovery.

Each step is independently shippable and testable; none requires Phase 3 RLS or any other in-flight work in this repo.

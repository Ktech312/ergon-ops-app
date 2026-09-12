# System Health — Consolidated Implementation-Ready Design

Status: **DESIGN, CONSOLIDATED AND IMPLEMENTATION-READY. NOTHING BUILT.** No schema, no migration, no UI, no alert wiring exists for any of this. This document consolidates three prior passes scattered across `PRODUCT_ERROR_VISIBILITY_AUDIT.md` (§15 original spec, 2026-09-08; A2.3 design proposal; A2.4 refinement, 2026-09-11) into one buildable design, per the 2026-09-12 overnight reliability closeout. It does not introduce new decisions beyond what's already been made — see §9 for the one item still genuinely open.

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

## 10. Build sequencing

1. Migration: `system_health_events` table + the write helper function (server-side, callable from any RPC that wants to log a health event) + the partial dedup index.
2. A frontend `recordSystemHealthEvent` counterpart for client-observed failures the RPC layer wouldn't see directly (e.g. a `console.error` call site that's judged worth elevating) — NOT every `console.error` in this codebase, only the ones already identified as durable-worthy in §1.
3. Admin → System Health panel (read-only list + Acknowledge/Retry actions).
4. Retention job (a cron task, matching the existing `api/cron/task-overdue` pattern) that rolls 90-day-old resolved rows into the summary tier.
5. Alert wiring, once §9's channel question is answered.

Each step is independently shippable and testable; none requires Phase 3 RLS or any other in-flight work in this repo.

# Ergon Ops — Error-Handling & Failure-Visibility Audit

Priority 5 of the 2026-09-08 overnight work queue. Read-only audit — no files were modified to
produce this report. Scope: `src/persistence.ts` (10,700 lines), `src/main.tsx` (25,116 lines),
`api/*.js`, `api/_lib/*.js`, `api/cron/*.js`, `vercel.json`. All citations are file:line
references verified against the current source at audit time.

**Read this before trusting any "unchecked"/"none check"/"remains entirely unchecked" claim
below about a restore or movements/builds/allocations write function.** This document was
written across multiple sessions and originally described `saveBuildTransactions`,
`saveInventoryMovements`, `saveProjectAllocations`, `saveRestoredPurchaseRequests`, and
`saveRestoredProjectDocuments` as having completely unchecked writes (true when §5/§6 and the
original A2.2 table below were written). **As of 2026-09-11 (task 5, then two same-day correction
passes), all five now check their own write's response and row count, and all five now also check
their prerequisite lookup responses before writing (including a missing/blank sku, which needs no
product decision since the relevant column is `NOT NULL`)** — see **A2.2c** for the current,
authoritative status of every one of these functions, including exactly what remains unresolved
(multi-step non-atomicity, and unresolved OPTIONAL associations, which are preserved as-is and
flagged as an open product/data-quality decision, not settled by the schema being nullable). Every
sentence below claiming one of these five is unchecked is describing a **historical, since-fixed**
state, not current behavior — each such sentence is now flagged inline where it appears, but if
you find one that isn't, treat A2.2c as authoritative over any older section in this file.
**None of this has been committed, pushed, deployed, or verified against production** — see
A2.2c's own explicit statement of that.

**Update, 2026-09-11 (later same day): `saveDeviceRecipes` is no longer non-atomic.** Migration
130 (`backend/supabase/migrations/130_atomic_equipment_recipe_save.sql`) and its verification
script were run and passed in E's production Supabase project, and `saveDeviceRecipes`
(`src/persistence.ts`) was rewired to call the new `rpc/save_equipment_recipe` once per recipe
instead of the old multi-request PATCH/INSERT/upsert/delete sequence this document's A2.2/A2.2c
entries describe below. Every claim below that `saveDeviceRecipes` is "non-atomic," has an
"unchecked update path," or "silently skips on failure" (including the specific entry at what was
line ~485 and the write-map row for `saveDeviceRecipes`) is now **historical, since-fixed** —
each recipe's save is atomic inside the RPC's own transaction. See
`PRODUCT_EQUIPMENT_RECIPE_ATOMIC_SAVE_PLAN.md` §16 for the authoritative, current status and what
this pass actually changed. The two-session concurrency check remains explicitly deferred, not
run. This update does not touch any other function this document covers — `saveProjectSites`'s
BOM lines, the Project BOM RPC, and every other still-open item below remain exactly as
described.

---

## 1. Executive summary

Ergon Ops has a **real, working fix pattern** for the two failure classes this audit was asked to
check (empty-array-on-failure loaders, and writes that don't verify RLS actually let the row
through). That pattern was applied to a small number of functions — mostly reactively, after a
specific incident (`loadInventoryMovements`, `loadProjectDocuments`, `loadSalesQuotes`,
`deleteEquipmentType` and the ~40 delete/status-change functions that already check
`rows.length === 0`). It was **not** applied systematically. The result is a codebase split into
two populations:

- A well-hardened population (mostly deletes and status changes) that correctly distinguishes
  "nothing to delete" from "the delete was silently blocked."
- A much larger, unhardened population (63 of 67 loaders that fetch lists/records, and ~35 write
  functions) that still convert `!response.ok` into `[]`/`null`/`false`/silent-return,
  indistinguishable from genuine empty data or a genuine no-op success.

The two specific incidents named as a live spot-check (`direct_messages` PATCH and
`app_known_users` POST both returning 503 during a normal Sales-page load, 2026-09-08) are both
**confirmed real** with exact code citations (§13). The push-notification per-subscription
failure fix is real and does not need an email analog, because every email route sends to exactly
one recipient — but the delivery-outcome data it (and its email/Slack siblings) write to
`notification_deliveries` is **never read back anywhere in the app**, so "did the email/Slack/push
actually go out" is answerable only by querying Supabase directly.

---

## 2. Classification taxonomy used below

| Class | Meaning |
|---|---|
| **Expected fallback** | Failure degrades to a sensible default; low/no business risk. |
| **User-visible failure** | The acting user sees *something failed*, but no wider signal exists. |
| **System Health event** | Should appear on an ops/health surface, but currently doesn't. |
| **Administrator alert** | Should page/notify an admin; currently invisible even to admins. |
| **Technical diagnostic** | Only in Vercel/browser console logs; not part of the product at all. |
| **Security-sensitive event** | Repeated/anomalous failures that could indicate abuse; needs its own visibility, separate from ordinary error noise. |

---

## 3. Empty catches / silently-swallowed promises

**No literal `catch {}` / `catch (e) {}` exists anywhere in `src/main.tsx` or `src/persistence.ts`**
(verified by direct grep for both forms). The codebase's actual silent-failure idiom is the
promise-chain equivalent: `.catch(() => {})` / `.catch(() => undefined)`.

- **`src/main.tsx`: 44 occurrences** of `.catch(() => {})`, e.g. lines 1171, 1546-1549, 1724-1726,
  1754, 1796, 1823, 1853-1854, 2174, 2353-2386, 2678, 3047-3048, 4465-4537, 4610/4623/4636
  (delivery-failure logging that then re-swallows its own logging failure), 4658, 4675, 4708-4710,
  5019-5027, 15017, 15111, 15183-15187.
- **`src/persistence.ts`: 6 occurrences** of `.catch(() => undefined)` at lines 523, 569, 968
  (`upsertKnownUser`), 2630, 3316 (`recordNotificationDelivery`), 9341.

**Classification:** Mixed. Most of these load a *secondary* list (channel members, reactions,
standard install times) where "keep showing stale/empty data, try again next reload" is a
reasonable **expected fallback** — genuinely low business impact. A minority guard **user-visible
or admin-relevant writes** (see §6-8) and are misclassified as low-risk by virtue of using the
same idiom as the harmless ones. The idiom itself isn't the problem; it's that it's applied
uniformly regardless of what's behind it.

---

## 4. Loaders that turn a failed request into an empty result (the big one)

This is the pattern already fixed **in exactly three places**:

| Function | Line | Fix |
|---|---|---|
| `loadInventoryMovements` | `persistence.ts:5710` | Throws on `!response.ok` (5718-5719); dedicated regression test suite (`src/persistence.critical-loaders.test.ts`). |
| `loadProjectDocuments` | `persistence.ts:4606` | Throws on `!response.ok` (4629-4630), including when its own 400-fallback also fails; same test file. |
| `loadSalesQuotes` | `persistence.ts:8522` | Throws with the real HTTP status and body (8530-8536). **No dedicated regression test.** |

Both `loadInventoryMovements` and `loadProjectDocuments` are wired to `criticalLoadErrors` state
(`main.tsx:1209`), which drives a **"Sync issue (N)"** pill in the top nav (`main.tsx:6931-6937`)
plus a per-screen error banner with a Retry button (`main.tsx:7375-7376,7600-7603`).
`loadSalesQuotes` throws but is wired to a narrower, local status string (`salesQuoteStatus`,
`main.tsx:3025-3038`) instead of the global banner — still user-visible, just inconsistent.

**The other 63 of 67 `load*` functions in `persistence.ts` still have the exact bug this fix was
written for**: `!response.ok` falls straight into a bare `return [] / null / false / {}`, with no
throw and no caller-visible signal.

**Core business-data loaders confirmed unfixed (read directly, not just pattern-matched):**

| Function | Domain | Line(s) |
|---|---|---|
| `loadInventoryItems` | Inventory (every SKU, every screen) | `5148-5150,5154-5156,5160-5162` |
| `loadPurchaseOrders` | Purchasing | `7664,7675,7693-7695,7699,7701-7703` |
| `loadPurchaseRequests` | Purchasing | `4910-4912,4916-4918` |
| `loadVendors` | Purchasing | `7758-7760` |
| `loadTasks` | Tasks | `2867-2869` |
| `loadProjectSites` | Projects | `6652-6654,6658-6660` |
| `loadProjectLedgerInfo` | Projects (warranty/kickoff ledger) | `6842-6843` |
| `loadDeviceRecipes` | Inventory (build BOMs) | `5407-5409` |
| `loadCatalogItems` | Catalog/pricing | `2302-2304` |
| `loadTeamMembers` | Admin/roster | `3124-3126` |
| `loadChannels`, `loadClients`, `loadNotifications`, `loadCatalogPriceChangeRequests`, `loadAllKnownUsers` | Messaging/CRM/notifications | `1373,1545,3276,2494,997` |
| `loadScheduleTemplates`, `loadSubmittalsForProject`, `loadFormSchema`, `loadProposalsForQuote` | Sales/PM workflow | `3517,3741,3924,10466` (differently-named response variables, e.g. `templatesRes.ok` — easy to miss on a naive grep) |

**Full remaining tail** (same anti-pattern, lower individual blast radius): `loadDeletionLog:188`,
`loadOneOffReconciliations:244`, `loadUserRoleMode:581`, `loadOwnRoleKeys:601`,
`loadUsersByRole:625`, `loadOwnAllowedViews:642`, `loadInvites:818`, `loadConversations:1094`,
`loadConversationMessages:1108`, `loadDirectMessageReactions:1186`, `loadChannelMembers:1495`,
`loadChannelMessages:1616`, `loadChannelMessageReactions:1677`, `loadChannelCanvas:1735`,
`loadUnreadDirectMessageCounts:1815`, `loadAllUserRoles:1897`, `loadAllAllowedViews:1924`,
`loadAllAdmins:1945`, `loadAdminEmails:2679`, `loadOwnApprovalStatus:2696`,
`loadAllApprovalStatuses:2713`, `loadDeletedTasks:2887`, `loadTaskActivity:3032`,
`loadAllTaskActivity:3053`, `loadNotificationRules:3375`, `loadStandardInstallTimes:3439`,
`loadHandoversForProject:4067`, `loadPresalesRules:4157`, `loadSiteHardwareRules:4255`,
`loadTaskHardwareDependencies:4360`, `loadInventoryItemSkusByIds:4433`,
`loadBuildTransactions:5751`, `loadProjectAllocations:5878`, `loadInstalledAssets:6931`,
`loadProjectStakeholders:7074`, `loadRemoteAppState:7179`, `loadDeletedPurchaseOrderFiles:8144`,
`loadDeletedSalesQuotes:8722`, `loadDeletedSalesQuoteImages:9404`,
`loadDeletedProjectLocations:9563`, `loadDeletedProjectLocationImages:9826`,
`loadProposalTemplateSections:10336`, `loadSalesQuoteIntakeResponse:10615`.

(`loadCompanyBranding:2039` fits the pattern but degrades to a fixed `{companyName:"Ergon", ...}`
default — genuinely low-stakes, closer to Expected Fallback.)

**Why this matters beyond the count:** even where `persistence.ts` *does* throw correctly, several
call sites in `main.tsx` re-swallow it — e.g. `searchMessages` (§9) and most of the
`.then(setX).catch(() => {})` initial-load effects. Fixing only the persistence layer without
auditing every call site leaves the same user-facing bug.

**Classification:** **User-visible failure** at minimum for every one of these; **System Health
event** for the ones behind data admins rely on for money/inventory decisions
(`loadInventoryItems`, `loadPurchaseOrders`, `loadPurchaseRequests`, `loadProjectLedgerInfo`).

---

## 5. fetch calls that never inspect `response.ok`

Beyond the loaders above, a distinct and arguably worse set of calls **never check `.ok` at all**
— the request fires, the response is discarded outright. `persistence.ts`, function:line:

`upsertKnownUser:957`, `markConversationRead:1876` (see §13a), `addDirectMessageReaction:1197`,
`removeDirectMessageReaction:1208`, `addChannelMessageReaction:1688`,
`removeChannelMessageReaction:1699`, `removePushSubscription:1864`, `markWelcomeSeen:2626`,
`addTaskActivity:3067`, `ensureTeamMemberForSelf:3217`, `recordNotificationDelivery:3312`,
`markNotificationRead:3324`, `markAllNotificationsRead:3336`, `updateFormSchemaField:3997`,
`updateHandoverResponses:4094`, `submitHandover:4105`, `updateSiteHardwareRule:4297`,
`updateTaskHardwareDependencyStatus:4399`, `forceDeleteInventoryItem:5250`,
`saveInventoryItems:5346`, `saveDeviceRecipes:5454/5494/5508`, `saveBuildTransactions:5801`,
`saveInventoryMovements:5936`, `saveProjectAllocations:5981`, `saveProjectSites:6737/6760/6788`,
`updateProjectLedgerInfo:6871`, `updateInstalledAsset:6991`, `updateProjectStakeholder:7129`,
`restoreFullBackupSnapshot` (via `saveRestoredPurchaseRequests:7354`,
`saveRestoredProjectDocuments:7383`), `updateVendor:7810`, `updateSalesQuoteProposalFields:8771`,
`deleteSalesQuoteBomLinesByLocationSource:8820`, `updateSalesQuoteBomLineCatalogLink:8830`,
`updateSalesQuoteLocation:8911`, `updateSalesQuoteLocationItem:8985`,
`updateProjectLocation:9508`, `updateProjectLocationItem:9642`,
`createProjectFromClosedWonQuote:10147/10164/10215/10257`, `updateSalesQuoteInfo:10695`.

**[SUPERSEDED, partial — this list is a point-in-time citation dump from the original 2026-09-08
audit; many entries have since been fixed locally across later passes this same file documents.]**
As of 2026-09-11, this list no longer reflects current behavior for: `ensureTeamMemberForSelf`,
`updateFormSchemaField`, `updateSiteHardwareRule`, `updateVendor`,
`deleteSalesQuoteBomLinesByLocationSource`, `updateSalesQuoteBomLineCatalogLink`,
`updateSalesQuoteInfo` (all fixed task 2, see A2.2a's resolved table), `saveInventoryItems`,
`saveDeviceRecipes`, `saveProjectSites` (fixed 2026-09-10/11, see the entries above this addendum),
`createProjectFromClosedWonQuote` (superseded entirely by migrations 127/128, see the Addendum
below), and `saveBuildTransactions`/`saveInventoryMovements`/`saveProjectAllocations`/
`saveRestoredPurchaseRequests`/`saveRestoredProjectDocuments` (fixed task 5, see A2.2c). Every
other name in this list is still an accurate, current, unfixed finding — this note narrows the
list, it does not retract it wholesale.

---

## 6. Writes that don't confirm a row was actually affected

The reference pattern (`deleteEquipmentType`, `persistence.ts:5526-5551`) is: mutate with
`Prefer: return=representation`, check `response.ok`, then check `rows.length === 0` and treat
that as a distinct "RLS silently blocked this" failure. This is **correctly and broadly applied**
— roughly 40 delete/status-change functions across inventory, purchasing, projects, and
sales-quote code all check `rows.length === 0`.

**The functions that skip it entirely are the same set as §5** — every write in that list fires
without `Prefer: return=representation` and without a rows-affected check, so a `0`-row
RLS-blocked "success" and a real success are indistinguishable. Highest-impact:

- **`restoreFullBackupSnapshot` (`persistence.ts:7291-7325`)** — the disaster-recovery restore
  path. Delegates to `saveInventoryItems`, `saveDeviceRecipes`, `saveProjectSites`,
  `saveRestoredPurchaseRequests` (7333-7359), `saveRestoredProjectDocuments`, and
  `saveMovementsBuildsAllocations` — **[SUPERSEDED 2026-09-11, see A2.2c] none check whether their
  POST/PATCH actually wrote anything.** This was true when this section was written; as of
  2026-09-11 every one of these functions checks its own write's response/row-count AND its
  prerequisite lookups, locally, not yet deployed — see A2.2c for current status and what
  specifically remains open. A partial or fully-blocked restore returns success with zero
  indication was the historical finding this section described.
- **`updateProjectLedgerInfo` (`persistence.ts:6855-6876`)** — warranty-expiration and kickoff-date
  edits; declared `Promise<void>`, unconditionally returns after firing the PATCH.
- **`createProjectFromClosedWonQuote` (`persistence.ts:10079` on)** — fires four unchecked inserts
  (scope of work, BOM lines, location items, location images); any one silently failing means the
  new project is missing scope/BOM/photos with no error anywhere.
- **`updateSalesQuoteInfo`, `updateSalesQuoteProposalFields`, `updateVendor`,
  `updateSiteHardwareRule`, `updateTaskHardwareDependencyStatus`** — ordinary edit forms across
  Sales/Vendors/PM that give a false "saved" toast on RLS block.

**Classification:** `restoreFullBackupSnapshot` — **Administrator alert**. The rest — **User-visible
failure**, several bordering on **System Health event** given they touch money/inventory.

---

## 7. Fire-and-forget actions

`main.tsx` has 27 `void <asyncCall>(...)` sites. Most (23) are `void triggerNotification(...)`,
internally hardened — its own `try/catch` per channel, and calls `recordNotificationDelivery` on
both success and failure (`main.tsx:4599-4639`). Two are not:

- **`void addTaskActivity(taskId, ...)` (`main.tsx:4314`)** — writes a task audit-log entry with
  no await, no catch, and `addTaskActivity` itself never checks `response.ok` (§5). `HANDOFF.md`
  already documents a live, real 503 on `POST task_activity_log` as a "pre-existing, unrelated
  transient Supabase blip" — this exact silent-failure path has already fired in production and
  was noticed only by accident during unrelated manual QA, not by any error-handling in the app.

  **✅ RESOLVED LOCALLY, NOT DEPLOYED (2026-09-11, overnight local-only pass, classification corrected same day) — improved technical diagnostics only, still best-effort by design.** The function stays fire-and-forget and never throws (a logging failure must not block the task action that already succeeded) but now reads and logs the real failed response body, status, and task id via `console.error` (corrected same day from an earlier version that logged the activity's own business message instead of the actual diagnostic detail). **Stated precisely, not left to imply more**: this is an improved technical diagnostic, visible only in that browser tab's own developer console at the moment it happens — it is **not durable logging**, **not an administrator alert**, and **not a System Health event**. An admin not personally watching that exact console will never see it; the underlying audit-trail gap this section describes is still just as invisible to anyone else as before. This is a precondition for a future durable/admin-visible version (§A2.3), not that version itself. 4 regression tests, `src/task-activity-logging.test.ts`. **Not committed, pushed, or deployed.**
- **`void upsertKnownUser(...)` (`main.tsx:2677`)** — see §13.

**Classification:** User-visible failure (audit-trail gap, not data loss) for `addTaskActivity`.

---

## 8. Background job (cron) health

Exactly one scheduled job: `api/cron/task-overdue.js`, daily at 13:00 UTC (`vercel.json:1-8`).
The handler is well-written — logs a per-run summary (`scanned=N created=N`) and logs individual
insert failures with task id + HTTP status, without logging secrets.

**But there is zero product-facing health state for it.** Nothing in the app records "last cron
run: <timestamp>, scanned N, created M" anywhere a human sees it without opening Vercel's function
logs. If `CRON_SECRET` is misconfigured, Supabase is down at 13:00 UTC, or the cron simply stops
firing, **the only symptom is that overdue-task notifications quietly stop appearing.**

**Classification: System Health event.** The cleanest case in the audit for the health-status spec
in §15 — a job that already logs everything needed, just nowhere the product surfaces it.

---

## 9. Search failures indistinguishable from "no results"

`searchMessages` (`persistence.ts:1783-1802`) returns `[]` on `!response.ok` for both its
`direct_messages` and `channel_messages` queries rather than throwing. Both callers in `main.tsx`
compound this with `.catch(() => setMessageSearchResults([]))` /
`.catch(() => setFullMessageSearchResults([]))` (`main.tsx:5487,5501`) — even if `searchMessages`
were fixed to throw, the UI would still flatten the error back into "no results" today. A user
searching for a real message during a Supabase blip sees the same empty state as searching for
something never sent.

**Classification: User-visible failure**, bordering on **System Health event** — a double swallow
(persistence layer *and* UI layer).

---

## 10. External delivery failures (email/push/Slack) invisible outside logs

The most interesting finding in the audit, because the app **already built the right mechanism
and never finished wiring it up.**

`recordNotificationDelivery` (`persistence.ts:3301-3317`) writes one row per (notification,
channel) to `notification_deliveries` with `status: "sent"|"failed"|"skipped"` and the real error
message, called for every email/Slack/push attempt (`main.tsx:4608,4610,4621,4623,4634,4636`) —
a genuinely good design.

**But `notification_deliveries` is never read back anywhere.** No `loadNotificationDeliveries`,
no admin table, no per-notification delivery-status indicator anywhere in the UI. The data exists
in Supabase and answers exactly the question this audit was scoped to check — the honest answer
is it's visible in *neither* Vercel logs nor the product: the write itself is
`.catch(() => undefined)` (`persistence.ts:3316`), so a failed delivery-status write is itself
silent, and nothing ever reads the successful writes back.

**Classification: Administrator alert** — the data model already supports building one.

---

## 11. Rate-limit events with no admin-visible record

`api/_lib/rateLimit.js` is well-engineered — durable via Upstash Redis with an in-memory fallback,
and logs when the durable check itself fails. **It does not log anything when a rate limit is
actually hit** — `checkRateLimit` just returns `false`, the route responds `429`, end of story. No
counter, no log line, no table tracking repeated hits. Every rate-limited route
(`send-push.js:107`, `send-notification-email.js:54`, `send-notification-slack.js:68`,
`send-proposal-email.js:40`, `send-submittal-email.js:38`, `send-invite-email.js:26`) inherits
this — a legitimate abuse signal produces zero admin-visible record.

**Classification: Security-sensitive event** — should never be bundled with ordinary error noise.

---

## 12. No "last successfully refreshed" indicator anywhere

A repo-wide search of `main.tsx` for "last refreshed"/"lastRefreshed"/"last synced"/"last
updated"/"Last saved" returns **zero matches**. No screen — Inventory, Purchasing, Sales, Reports,
or the top-nav pill itself — tells the user when the data on screen was last known-good.
`criticalLoadErrors` shows *that* something is currently broken, but even a fully green screen
gives no way to tell "current as of 9:14am" from "silently stale since yesterday."

**Classification: System Health event** (systemic gap, not a per-screen bug).

---

## 13. Confirm/deny — the two named live incidents

### (a) `direct_messages` PATCH and `app_known_users` POST returning 503, Sales-page load — CONFIRMED, root cause identified

- **`markConversationRead`** (`persistence.ts:1870-1884`) fires the `direct_messages` PATCH with
  **no assignment of the response to a variable and no `.ok` check at all**. Its caller
  (`main.tsx:2384-2386`) does `.then(() => setUnreadMessageCounts(...zero...)).catch(() => {})`.
  Because `fetch()` only *rejects* on a network-level failure — never on an HTTP 4xx/5xx — a `503`
  **resolves normally**, so `.then()` fires and the UI optimistically zeroes the unread badge even
  though the server never actually marked anything read. This is worse than silent: it's a
  false-positive success.
- **`upsertKnownUser`** (`persistence.ts:952-969`) fires the `app_known_users` upsert POST with
  `.catch(() => undefined)` and, again, no `.ok` check. Called as `void upsertKnownUser(...)`
  (`main.tsx:2677`) — fire-and-forget on top of already being silent internally.

Both functions would swallow a `503` completely, exactly matching the reported symptom.
`HANDOFF.md`'s own work log independently documents this class of transient Supabase `503`
occurring in production before, so this is consistent with the app's known error profile, not an
anomaly.

### (b) Is `send-push.js`'s per-subscription fix the only place this pattern was applied, or does email have the same gap? — No email gap exists, because the scenario doesn't apply there

`send-push.js` fans one push out to *every device* a user has subscribed on, so it needs a
`failures` array keyed per-subscription. Every email-sending route sends to **exactly one
recipient per call** — no fan-out, so no array of per-recipient outcomes to lose. Each already
returns `{sent: false, error: ...}` on failure. **Multi-recipient fan-out is handled correctly one
level up**, in `main.tsx`'s `triggerNotification`, which loops per-recipient and calls
`recordNotificationDelivery` for each — the push fix's spirit is already satisfied for email/Slack
by a different, appropriate mechanism. The real gap is not in the sending code — it's §10: every
correctly-captured outcome is written and never read.

---

## 14. Findings ranked by business impact

1. **`restoreFullBackupSnapshot` unverified writes** (§6) — a disaster-recovery restore that can
   silently under-restore. Highest impact because it's the safety net for everything else here.
2. **63 unfixed `load*` functions**, especially `loadInventoryItems`, `loadPurchaseOrders`,
   `loadPurchaseRequests`, `loadProjectSites`, `loadProjectLedgerInfo`, `loadVendors`, `loadTasks`
   (§4) — core inventory/purchasing/project data rendering as "empty" instead of "broken."
3. **`markConversationRead`/`upsertKnownUser` 503 swallowing** (§13a) — confirmed live incident;
   false-positive "read" state actively misleads users.
4. **Unchecked writes on ledger/vendor/project-conversion paths** (§6).
5. **`notification_deliveries` write-only table** (§10) — one UI screen from being useful.
6. **Cron job with no product-facing health state** (§8).
7. **Rate-limit hits with no admin-visible record** (§11) — the one security-angle item here.
8. **Message search failures reading as "no results"** (§9).
9. **No "last refreshed" indicator anywhere** (§12) — a cross-cutting trust gap.
10. **`addTaskActivity` fire-and-forget** (§7) — audit-trail gaps only, already observed live.

---

## 15. System Health — product specification (spec only, not implementation)

**Purpose:** one place, for admins/managers, answering "is anything in Ergon currently not
working the way it should, and do I need to do anything about it" — built on data the app is
already largely capturing (`criticalLoadErrors`, `notification_deliveries`, cron logs).

### 15.1 Data model — one "health event" record per tracked failure surface

| Field | Description |
|---|---|
| **Status** | `Healthy` / `Degraded` / `Down` / `Recovering`. |
| **Business impact** | Plain-language, pre-authored per surface — e.g. "Inventory counts on screen may be stale or wrong" vs. "A teammate's password-reset invite email did not go out." Tiered: Critical (money/inventory/data-loss-adjacent) / Moderate (workflow friction) / Low (cosmetic). |
| **Affected module/workspace** | Matches the app's existing nav taxonomy. |
| **Last success** | Timestamp of the last confirmed-good run — extends §12's gap into something structured. |
| **Retry state** | `Not retrying` / `Auto-retry scheduled` / `Manual retry available` — wires into the existing retry-button pattern, generalized to every tracked surface instead of two. |
| **Responsible person** | A role, not a named individual ("Whoever owns Purchasing data," "App admin"). |
| **Plain-language recovery instructions** | Authored per failure *type*. Never expose raw Postgres/HTTP error text to non-admin viewers. |
| **Technical reference ID** | The existing error text/status code, shown collapsed — what an admin pastes into a support request. |

### 15.2 Alert thresholds — designed against notification fatigue

- **No alert on a single failed request** — transient 503s are documented, known occurrences here.
- **`Degraded`** after 2 consecutive failures on the same surface within a rolling window.
- **`Down`, and only then an admin alert**, after 3 consecutive failures spanning at least 5
  minutes (guards against mistiming a burst of retries).
- **Security-sensitive events (rate-limit hits) never merge into the same alert stream** as
  ordinary Degraded/Down events — a distinct, lower-volume channel.
- **One alert per surface per incident**, not per failed request — no further alerts until
  recovery and a new failure.
- **Recovery is a quiet logged event, not a push alert.**

### 15.3 Where it surfaces

- Extends the existing "Sync issue (N)" pill from its current 2 tracked domains to all
  Critical-tier surfaces — same visual language.
- A dedicated Admin > System Health panel for the full table (all surfaces, all tiers, delivery
  log detail, cron last-run) — the natural home for `notification_deliveries`' currently-unused
  data.

---

## Appendix — evidence index

Empty catches/silent `.catch`: `main.tsx` (44 sites, §3); `persistence.ts:523,569,968,2630,3316,9341`.
Fixed loader references: `persistence.ts:5710-5723,4606-4634,8522-8540`; tests: `src/persistence.critical-loaders.test.ts`.
Write-path reference pattern: `persistence.ts:5526-5551`. Cron: `api/cron/task-overdue.js`,
`vercel.json:1-8`. Rate limit: `api/_lib/rateLimit.js:41-81`. Notification delivery log:
`persistence.ts:3301-3317`, called from `main.tsx:4608-4636`. Push per-subscription fix:
`api/send-push.js:219-265`. 2026-09-08 incident root cause: `persistence.ts:952-969,1870-1884`;
callers `main.tsx:2384-2386,2677`. Corroborating prior incidents: `HANDOFF.md` (task_activity_log
503s, prior silent write-path failures, One-Off Items silent non-persist, Create Purchase CHECK
constraint failure, `knownUsers` silently broken for non-admins).

---

## Addendum (2026-09-08, overnight pass) — findings not in the original audit above

Independently re-verified against current source; new findings only, not a re-check of everything above.

**`createProjectFromClosedWonQuote` — critical, partial multi-step write with no rollback. RESOLVED AND LIVE (2026-09-10, migrations 127+128, applied in Supabase, deployed to production as commit `9e8ce64`, and live-verified).** `persistence.ts:10102-10311` (original location; rewritten). The project/scope-of-work/BOM-lines/locations/location-items writes now happen inside one atomic, security-definer RPC (`create_project_from_quote`, migration 127, with its INSERT trigger chain hardened by migration 128 against a live search-path bug the migration's own production verification surfaced) — either the whole structure is created correctly or none of it is, and the function is idempotent so a partial failure is always safely retryable. Only photo copying stays client-side (a Storage API call can't join a SQL transaction); each photo's copy+insert is now tracked individually, a failed row-insert cleans up its orphaned Storage object, a concurrent-retry uniqueness conflict is recognized instead of reported as a false failure, and the caller always sees a real report ("N of M photos copied", or a named list of exactly which photos failed) instead of the old always-identical success message. See `HANDOFF.md`'s migration 127/128 entries for the full design, the review history, and the production verification (SQL test script passed with zero skips; deployed bundle confirmed live; UI checked on a real Closed-Won quote without triggering a real conversion). This finding is closed — the fix is live, not just ready for review.

**`restoreFullBackupSnapshot` — critical, disaster-recovery restore with unverified writes.** `persistence.ts:7291-7325`. Delegates to `saveInventoryItems`/`saveDeviceRecipes`/`saveProjectSites`/`saveRestoredPurchaseRequests`/`saveRestoredProjectDocuments`/`saveMovementsBuildsAllocations` — none check whether the write actually took effect. **Employee sees**: "Restore complete," possibly right after a real incident, with no way to know a partial or fully-blocked restore just happened. **Severity: Critical** — this is the safety net for every other failure in this document; a silently-incomplete restore during an actual recovery event compounds the original incident. **Recovery**: require `Prefer: return=representation` + rows-affected check per restore sub-step, refuse to report "restored" unless every step's count matches the snapshot's expected count.

**Notification delivery outcomes are captured but never read back anywhere.** `triggerNotification` (`main.tsx:4452-4527`) correctly wraps each channel and calls `recordNotificationDelivery(...)` with the real status/reason per channel (confirmed against `api/send-push.js:124-129`'s honest fallback body). But `notification_deliveries` is never queried anywhere in the UI — no admin table, no per-notification indicator. **Employee sees**: nothing. A failed send (bad SMTP creds, missing VAPID keys, a 404'd Slack webhook, a rate limit) is invisible — exactly the class of bug this session's own migrations 119-124 found and fixed after it had been silently broken for a long time. **Severity: High** — the data already exists; this is a pure visibility gap, making it the highest-leverage single addition for a System Health screen. **Recovery**: a `status='failed'` view surfaced both as an Admin > System Health panel and a small per-notification "delivery: 2/3 channels failed" indicator.

**Two unchecked fire-and-forget writes with false-positive UI feedback.** `markConversationRead` (`persistence.ts:1876`, PATCH with no `.ok` check at all) and `upsertKnownUser` (`persistence.ts:957-969`, same shape plus `.catch(() => undefined)`). Because `fetch()` only rejects on network failure, an HTTP failure resolves normally and the `.then()` fires — the UI optimistically marks a conversation read or a user known even though the write never happened. **Severity: High** — worse than blank/empty, since it actively misleads (a confirmed prior live incident per the main audit's own root-cause section). **Recovery**: check `.ok`, revert the optimistic update on failure.

**Rate-limit trips have no durable trace beyond the single 429.** `api/_lib/rateLimit.js` — the calling user does see a clear message (confirmed via `main.tsx:2671-2685`), but repeated trips by the same actor (a real abuse signal) leave no admin-visible log. **Severity: Medium** (fine for the individual caller; a real gap for security monitoring). **Recovery**: a durable per-(route, actor) counter surfaced as a distinct "security events" feed.

**Redis (Upstash) fallback degrades silently.** `api/_lib/rateLimit.js:24-32,57-81` — missing config or a thrown call falls back to in-memory-per-instance limiting, logged only via `console.error`. **Severity: Low-Medium** — a deliberate, safe fail-open, but with zero product-facing signal that it happened. **Recovery**: a one-line "Redis: connected/degraded" indicator on the System Health screen.

**Cron job has no "did it run" signal beyond Vercel's own logs.** `api/cron/task-overdue.js` already logs a good per-run summary, but nothing surfaces "last run: X, scanned N, created M" anywhere a human would see without opening Vercel's dashboard. **Severity: Medium-High** — low-effort System Health candidate since the job already logs everything needed.

**No "last successfully refreshed" indicator anywhere in the app.** Repo-wide search for "last refreshed"/"lastRefreshed"/"last synced" returns zero matches. Even the existing hardened loaders' "Sync issue (N)" pill (`main.tsx:6931-6937`) only shows *current* brokenness, never staleness. This is the natural umbrella fix — every finding above becomes strictly less dangerous once a user can tell "current as of 9:14am" from "silently stale since yesterday."

---

## Addendum 2 (2026-09-10, overnight autonomous pass) — new findings, `restoreFullBackupSnapshot` implementation plan, and a System Health proposal

Read-only continuation of the audit above, run alongside drafting and reviewing migration 127. New findings only below (not a re-check of Addendum 1). Nothing in this addendum was implemented — see `HANDOFF.md` for the small, separately-diffed fixes that *were* made overnight, and their own regression tests.

### A2.1 New findings

**`saveProjectSites` — critical, the exact same silent-partial-write pattern `createProjectFromClosedWonQuote` had, in a different function.** `persistence.ts:6710-6850` (approx. — the live-edit/debounce-save path for the whole Projects page, and the bulk path `restoreFullBackupSnapshot` calls for project rows). The top-level `projects` upsert is checked (throws on `!response.ok`) and its row set is used to resolve `idByName` for every write after it — but `project_scope_of_work` (line ~6782) fires with **no `.ok` check at all**, silently absorbing an RLS rejection or a constraint failure. BOM lines use a delete-then-reinsert pattern per project (no natural per-line key) — the delete and the reinsert are two separate statements with no transaction wrapping them, so a failure between the two can leave a project's BOM lines empty rather than replaced. **Employee sees**: an edit (or a restore) that "saved," while a project's scope of work silently didn't change, or — in the worst case — a project's entire BOM list is wiped and not replaced. **Severity: Critical** — this is the same live, editable path real PMs use every day, not just the restore path. **Recovery**: same pattern as migration 127 — an atomic RPC per project (or per batch), or at minimum check every sub-write's `.ok` and surface a real per-project report instead of one blanket "saved."

  **✅ `project_scope_of_work` half RESOLVED, deployed commit `4ea2fd1` (2026-09-10).** The write now checks `.ok` and that the returned row count matches exactly (`!==`) what was sent; a failure logs full diagnostic detail via `console.error` and throws a plain message ("Some project details could not be saved.") that reaches the user through the existing sync-status pill. **⚠️ The BOM delete-then-reinsert half of this finding is explicitly NOT resolved** — still no transaction between the two statements, still Critical, exactly as described above. See `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` for the reviewed (not implemented) design: a `security definer` RPC per project, `for update` row-locked against concurrent calls, gated by `active_workspace_id()` as a temporary workspace guard, rejecting the whole call on an ambiguous item name. No migration exists; do not treat this half as fixed or in progress.

  **Full write map, current state as of 2026-09-11 (task 6 of the overnight local-only pass) — every operation `saveProjectSites` performs, in execution order:**

  | # | Operation | HTTP checked? | Rows verified? | Earlier writes already committed if this fails? | Partial-save / data-loss result | Employee sees | Retry safe? |
  |---|---|---|---|---|---|---|---|
  | 1 | `projects` upsert (POST, `on_conflict=project_name`, `return=representation`) | ✅ yes — throws on `!response.ok` | ⚠️ **No `sites.length` vs. returned-row-count check exists** — this is a real gap in verification coverage, not a confirmed partial-write bug. Corrected 2026-09-11 (review): a single multi-row `INSERT ... ON CONFLICT` is one atomic statement — an ordinary RLS `WITH CHECK` failure or constraint violation on any row fails the **whole** statement (already caught by the `!response.ok` check to its left), it does not silently drop just the offending row while the rest succeed. No specific trigger or policy in this schema is known to skip individual rows from a bulk upsert. If `savedRows.length` were ever observed to be less than `sites.length` on a 2xx response, that would be a genuine **integrity anomaly worth investigating** (e.g. a duplicate `project_name` within the same batch, which Postgres would normally reject outright rather than silently under-return) — not a proven, already-occurring mechanism. A row-count check here would still be reasonable **defensive verification** (the same posture already applied to `saveInventoryItems`/`project_scope_of_work`), but is not fixing a demonstrated bug. | N/A (first operation) | Not applicable absent a confirmed mechanism — see correction above | Not applicable | Not applicable |
  | 2 | `project_scope_of_work` upsert (POST, `on_conflict=project_id`, `return=representation`) | ✅ yes (fixed `4ea2fd1`) | ✅ yes, exact (`!==`) | ✅ yes — step 1's projects for every site in `idByName` are already committed | None — this step now throws before any BOM step (3-5) runs for **the whole batch**, not just the affected site | Sync-status pill flips to "error"; plain message ("Some project details could not be saved.") | Yes — this write and step 1's are both idempotent upserts by natural key |
  | 3 | `inventory_items` lookup (GET, read-only, resolves BOM item names to ids) | ⚠️ no — degrades to `[]` on failure | N/A (read) | ✅ yes — steps 1-2 for the whole batch are already committed | Every BOM line in this save cycle gets `inventory_item_id: null` instead of erroring — a silent **downgrade**, not a data-loss event, since `item_name` (the real identifier) is unaffected | Nothing — the BOM still saves, just with every catalog link missing until the next successful save cycle re-resolves it | Yes — next debounce cycle re-attempts the lookup |
  | 4 | `project_bom_lines` DELETE (`project_id IN (...)`, whole batch at once) | ❌ no — bare `await fetch(...)`, no variable assigned | ❌ no | ✅ yes — steps 1-3 committed | **The real critical gap.** If this DELETE itself fails (RLS, network), nothing is removed and step 5's INSERT would then create duplicate lines alongside the untouched old ones (not data loss, but a corrupt duplicate state) | Nothing — no throw, no log, the save looks identical to success either way | Not meaningfully "retryable" in the safe sense — a retry after a failed DELETE does not know the DELETE didn't happen, so it's a blind repeat, not an informed one |
  | 5 | `project_bom_lines` INSERT (bulk, `prefer: return=minimal`) | ❌ no — bare `await fetch(...)`, and `return=minimal` means even adding a check couldn't recover a row count without first changing this header | ❌ no | ✅ yes — steps 1-4 (including the DELETE) already committed | **The critical gap this whole document keeps returning to**: if step 4's DELETE succeeded and this INSERT then fails, every project in the batch has **zero BOM lines** until the next successful save cycle re-populates them from current React state — a real, if often self-healing (via the next edit's debounce), moment of "the BOM is actually empty in the database" | Nothing — no throw, no log; "Saved" and "silently wiped" look identical | Not safely retryable in the informed sense — same as step 4, a blind repeat with no signal of what actually happened last time |

  **Why steps 4-5 are correctly left unfixed by a response check alone** (restating the existing "NOT COVERED" comment in code for this write-map's own record): checking `.ok`/row-count on step 5 could prove the INSERT failed, but by then step 4's DELETE has already committed — there is no check that undoes it. The only real fix is one transaction spanning both (`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`), not a verification patch on this sequence.

  **Correction, 2026-09-11 (same day, review)**: this write map originally described step 1 as capable of "silently dropping one site" due to an RLS/constraint failure while the rest of the batch succeeded. That characterization overstated what's actually been confirmed. A multi-row `INSERT ... ON CONFLICT` fails atomically as one statement — an RLS `WITH CHECK` rejection or a constraint violation on any row aborts the whole statement (a non-2xx response, already caught above), not a partial success with the offending row quietly missing from the result. No specific trigger or policy in this schema has been found that could skip individual rows from a bulk upsert like this one. The absence of a row-count check on step 1 is still real and still worth closing as defensive verification (matching the posture already applied elsewhere), but it should not be described as a confirmed, already-occurring partial-write mechanism — it guards against an integrity anomaly that hasn't been demonstrated to happen, not one that has.

**`saveInventoryItems`'s stock-balance write is unchecked; only the item metadata write is.** `persistence.ts:5317-5397`. The `inventory_items` upsert (metadata: cost, category, tags, etc.) is well-guarded — checked, retried on a known migration gap, and validates the returned row count matches the sent count (throws if not, `persistence.ts:5363-5365`). The **stock-quantity write to `inventory_balances`** right after it (`persistence.ts:5382-5396`) has none of that: no `.ok` check on the first attempt, and the 400-retry's own result is also discarded. **Employee sees**: "Inventory saved" while on-hand/allocated quantities silently didn't update — the single number the warehouse actually relies on for "can I pull this for a build." **Severity: Critical** for the same reason `restoreFullBackupSnapshot` is: this is the number a physical pull decision gets made from. **Recovery**: check `.ok` (and ideally row count) on the balance write exactly like the item write beside it already does.

  **Consistency follow-up, RESOLVED LOCALLY, NOT DEPLOYED (2026-09-11, task 2 of the overnight local-only pass).** The item-metadata check itself was already correct in spirit but used `<` instead of `!==`, unlike the balance/scope-of-work checks fixed the day before. Reviewed and confirmed `!==` is safe here: this is a single-table `on_conflict=sku` upsert, and Postgres hard-errors on a duplicate sku within one payload (a real, distinct failure caught by the `.ok` check above it) rather than silently returning extra rows — there is no legitimate path for this specific write to return more rows than sent, so treating an over-count as a failure cannot produce a false positive. Message wording also brought in line with its sibling ("Some inventory item details could not be saved." — real detail now in `console.error`, not the thrown message). 5 new tests (zero/fewer/more/exact row counts, plus the outright-failure case) in `src/inventory-and-project-write-verification.test.ts`. **Not committed, pushed, or deployed.**

  **✅ RESOLVED, deployed commit `4ea2fd1` (2026-09-10).** The `inventory_balances` write now checks `.ok` and that the returned row count matches exactly (`!==`, not just `<`, so an unexpected over-count is also caught) what was sent; the migration-091 "retry any 400" fallback that used to sit here is removed entirely (migration 091 is confirmed live; the blind retry could have masked an unrelated validation error as a false success). Diagnostic detail (status/body/count) goes to `console.error` only; the user sees a plain message ("Some inventory quantities could not be saved.") with no RLS/implementation detail. Live-verified: the deployed bundle was fetched directly and confirmed to contain the new message strings and confirmed the old ones are gone.

**`saveDeviceRecipes`'s per-recipe UPDATE path is unchecked; the INSERT path silently skips on failure with no count.** `persistence.ts:5459-5520+`. Looping over recipes: an existing recipe's `PATCH equipment_types` result is discarded entirely (line ~5503); a new recipe's `POST` is checked, but a failure just `continue`s to the next recipe (line 5514-5516) with no running count of how many were skipped, no name recorded, nothing surfaced to the caller. **Employee sees**: "Recipes saved," with some subset of edited/new build recipes missing, and no way to know how many or which ones without manually diffing every recipe against what they expected. **Severity: High.**

  **⚠️ IMPROVED LOCALLY, NOT DEPLOYED, NOT TRANSACTIONAL (2026-09-11, overnight local-only pass, corrected same day after review).** This is a failure-visibility and input-validation fix, **not** an atomicity fix — do not describe it as making `saveDeviceRecipes` transactional or safe against partial writes, because it does not. What actually changed:
  - Every step now checks `.ok`; the two upfront lookups (`inventory_items`, `equipment_types`) throw on failure instead of silently degrading to an empty map (which, since `equipment_name` has a real unique index — migration 020 — meant a failed `equipment_types` lookup would previously cause every *existing* recipe to be silently dropped rather than duplicated, not a smaller bug than first described); the per-recipe PATCH is now checked and its row count verified (`=== 0` → RLS-block error); a failed INSERT throws immediately with the recipe's name in the log, instead of a silent `continue`; both component-line writes (upsert and delete) are checked for `.ok` and exact row count (`!==`).
  - **Two preflight checks now reject bad input before any write happens, for the whole batch**: (1) a component name that doesn't resolve to exactly one `inventory_items` row (zero matches, or more than one — a real catalog duplicate) rejects the entire save; (2) **added in a second correction the same day**: the same resolved `inventory_item_id` appearing twice within one recipe's own component list (identical names, or different names resolving to the same catalog row) also rejects the entire save — this closes a real gap the first preflight missed, since two duplicate component entries would otherwise reach the bulk `equipment_bom_components` upsert and could trigger a real Postgres uniqueness violation on `(equipment_type_id, inventory_item_id)` *after* that recipe's own `equipment_types` write had already committed. Quantities from duplicate entries are never auto-combined — that would be a business-behavior decision, not a technical one, and isn't made here.
  - **What this does NOT do, stated plainly rather than left implicit**: it is not atomic, at any level. Recipes are still processed one at a time as several separate, independently-committing PostgREST requests, not inside one database transaction. If recipe 2 of 3 fails, recipe 1's writes remain committed — this function cannot roll them back. Within a single recipe, its own `equipment_types` write can succeed and commit before a later component-line write for that same recipe fails. **Whole-call atomicity (every recipe succeeds or none do) and per-recipe atomicity (one recipe's own writes succeed or none of them do) both remain open follow-up work** — a real fix would need an RPC the same shape as `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`'s, not built here or now. What this pass actually achieves: a real failure is no longer silent (the caller reliably learns something went wrong and processing stops), and a whole class of genuinely bad input (unresolvable names, ambiguous names, duplicate components) is now caught before touching the database at all, instead of surfacing later as a raw, confusing constraint error mid-batch.

  Diagnostic detail (status/body/recipe name/count) goes to `console.error`; the user sees a plain message ("Some equipment recipes could not be saved."). 21 regression tests (`src/device-recipes-write-verification.test.ts`) cover every failure point, both preflight checks (including that a duplicate in one recipe doesn't falsely implicate an unrelated recipe legitimately sharing the same component once), and propagation to `restoreFullBackupSnapshot`. **Not committed, pushed, or deployed** — local only, per this pass's explicit boundary.

**`recordNotificationDelivery` (the audit's own recommended data source for System Health, see Addendum 1) can itself silently fail to record.** `persistence.ts:3292-3296`. The insert into `notification_deliveries` is wrapped in `.catch(() => undefined)` with no `.ok` check — meaning the very telemetry a future System Health screen (A2.3 below) would read could have gaps that look identical to "nothing failed" rather than "we don't know." **Severity: Medium** (doesn't affect the user directly, but undermines the reliability of the fix Addendum 1 recommended). **Recovery**: at minimum log a `console.error` on failure so it's visible in Vercel logs even before a UI exists to show it; consider a low-volume retry given how infrequent and important these writes are.

  **✅ RESOLVED LOCALLY, NOT DEPLOYED (2026-09-11, overnight local-only pass, classification corrected same day) — improved technical diagnostics only, not a System Health fix.** Both the HTTP-failure and network-failure paths now log the real status and response body via `console.error` (matching the `upsertKnownUser`/`markConversationRead` precedent from the prior session's pass, and corrected the same day to include the response body, not just the status); the function still never throws, so a delivery-log write failing can never block or fail the real notification it's recording the outcome of. Recipients, routing, deduplication, and delivery rules are untouched — this function has no say over any of those. **What this is, stated precisely rather than left to imply more**: an improved *technical diagnostic*, visible only in that specific browser tab's own developer console at the moment the failure happens. It is **not durable logging** (nothing is persisted anywhere a later session or a different device could read), **not an administrator alert** (no one is notified), and **not a System Health event** (there is still no product-facing surface for this at all). An admin who isn't personally watching that exact browser's console when the failure occurs will never see it. This remains exactly the kind of finding §A2.3's System Health design proposal exists to eventually close — logging it is a precondition for a future durable/admin-visible version of this, not a substitute for one. 4 new regression tests (`src/notification-delivery-logging.test.ts`). A low-volume retry (mentioned as a "consider" in the original recovery note) was deliberately not added — it would be a behavior change beyond "check and log," and this pass's instructions were to add logging only where safe. **Not committed, pushed, or deployed.**

**`releaseTransactionLock` is fire-and-forget; a failed release can strand a real lock.** `persistence.ts:560-570`. If the PATCH fails (network blip, RLS), the lock row's `released_at` never gets set, and (depending on whether locks have a separate timeout mechanism — not traced further in this pass) another user attempting the same inventory item/project/build/purchase-request could see "someone else is editing this" indefinitely with no way to know it's a stale, orphaned lock rather than a real one. **Severity: Medium** — flagged as an open question rather than a confirmed bug, since whether there's a separate expiry safety net wasn't traced in this pass. **Recovery**: confirm whether `app_transaction_locks` has a TTL/expiry check anywhere; if not, add one, and/or check `.ok` here and retry or surface a "could not release lock" warning.

  **✅ RESOLVED as an open question, 2026-09-11 (local-only, read-only trace — no code changed, per explicit instruction not to alter lock behavior). A real TTL/expiry safety net already exists; a failed release cannot strand a lock indefinitely, only for up to 5 minutes.** Full trace: `acquireTransactionLock` (`persistence.ts:528-558`) calls the `acquire_transaction_lock` RPC (migration 069) with `p_ttl_seconds: 300`, which does `INSERT ... ON CONFLICT (workspace_key, lock_key, lock_type) DO UPDATE ... WHERE released_at IS NOT NULL OR expires_at < now()` — a lock row is reclaimable the instant it's *either* released *or* its `expires_at` (set to `now() + 300s` at acquisition) has passed, independent of each other. So a failed `releaseTransactionLock` PATCH leaves `released_at` null, but `expires_at` was already stamped at acquisition time regardless — the same key becomes acquirable again automatically once that 5-minute window elapses, with no manual cleanup and no dependency on the release ever succeeding. The one caller (`withProductionLock`, `main.tsx:5564-5593`, guarding 7 call sites: Inventory add/update/adjust/transfer, allocate/ship, both build actions) always attempts release in a `finally` block regardless of whether the guarded action succeeded, and since `releaseTransactionLock` itself never throws, that `finally` can never mask or interfere with a real error from the guarded action. **Revised severity: Low** (was Medium) — the worst case is a spurious "Record is locked for another operation" for up to 5 minutes after a release genuinely fails, not an indefinite stranding; genuinely low-frequency (requires a release PATCH to fail, which itself requires a network blip or RLS issue on an already-succeeded action) and self-healing with no admin intervention needed. **Not fixed and not changed, per explicit instruction** — if `releaseTransactionLock` is ever revisited, the two real remaining gaps are (a) it still doesn't log a failed release at all (same silent-fetch shape as the other Addendum 2 findings, would need its own small logging-only fix), and (b) the 5-minute window is a fixed value, not configurable per lock type, which is fine for today's usage (short synchronous actions) but worth reconsidering if a future guarded action ever legitimately takes longer than that.

  **Extended 2026-09-11 (task 6 of the overnight autonomous pass), answering the remaining specific questions this finding hadn't addressed — still read-only, still no code/behavior change:**
  - **Clock/time comparison mechanics, confirmed from the schema (`app_transaction_locks`, migration 008: `expires_at timestamptz not null default now() + interval '5 minutes'`) and the RPC (migration 069)**: every `now()` call in this mechanism — the original stamp, the RPC's `WHERE ... expires_at < now()` reclaim check, everything — runs **inside Postgres, on the database server's own clock**, never the caller's browser clock. A signed-in user's local system time is never read or trusted anywhere in this mechanism. This closes off an entire class of "what if the client's clock is wrong" risk that a client-stamped expiry would have had.
  - **Abandoned browser sessions, confirmed safe**: `expires_at` is set once, at acquisition time, and never extended, refreshed, or dependent on any later check-in from the client. If a tab is closed, the browser crashes, or a device loses power immediately after a lock is acquired (before `releaseTransactionLock` ever runs), the lock still expires at the same fixed wall-clock time it would have if the session had stayed open and failed to release normally — recovery is purely time-based, not contingent on the client ever coming back. This is the same guarantee that protects against a failed release; an abandoned session and a failed release are, from the lock's perspective, indistinguishable and equally well-handled.
  - **What the user currently sees, precisely**: nothing at all *unless* they personally attempt to acquire the exact same lock key while it's still genuinely held (not yet expired, not yet released) — at that moment, and only then, `withProductionLock`'s catch (`main.tsx:5564-5593`) shows `window.alert("Record is locked for another operation: <key>")`. There is no ambient "this record is currently locked by someone else" indicator anywhere, no list of currently-held locks visible to an admin, and no way for a user to tell a spurious lock-contention message apart from a real one currently in use by a teammate. This is a minor, already-implicitly-covered UX gap (an admin-visible "active locks" view), not a new finding — noted here for completeness since the question was asked directly.
  - **On testing this without touching production**: a genuine verification of the reclaim logic (that `acquire_transaction_lock`'s `WHERE released_at IS NOT NULL OR expires_at < now()` clause actually reclaims an expired row) requires exercising real Postgres `now()`/interval arithmetic against a live database — this is SQL-level behavior a Vitest unit test against mocked `fetch` responses cannot meaningfully prove (mocking the RPC's response doesn't exercise the RPC's own logic). A real test would need either a live Supabase connection (out of scope for a local-only pass) or a local Postgres instance running this migration — not attempted tonight, flagged rather than faked with a shallow mock that wouldn't actually prove anything.
  - **Conclusion, restated**: no design work is needed here — a safe, self-contained, server-clock-based recovery mechanism already exists and already covers both a failed release and an abandoned session identically. The only real remaining gaps are the two already listed above (missing failure log, fixed non-configurable TTL), both minor and neither blocking.

### A2.2 `restoreFullBackupSnapshot` — implementation plan (read-only audit; nothing implemented or run)

Full read-only trace of `persistence.ts:7336-7370` and everything it calls. This is the disaster-recovery path — the safety net for every other finding in this document — so its own reliability matters more than any individual feature it restores.

**What it does today, table by table:**

| Sub-call | Tables/Storage touched | Checked? |
|---|---|---|
| `saveInventoryItems` | `inventory_items` (upsert), `inventory_balances` (upsert) | Items: yes, with row-count validation. Balances: **✅ fixed, commit `4ea2fd1` (2026-09-10)** — `.ok` + exact row-count (`!==`) check, migration-091 fallback removed. |
| `saveDeviceRecipes` | `inventory_items` (read-only lookup), `equipment_types` (update or insert), `equipment_bom_components` (upsert + delete, fully traced this pass) | **⚠️ improved locally, NOT deployed, NOT atomic (2026-09-11)** — every step now checks `.ok` and, where PostgREST reports one, exact row count, plus two preflight input checks (see the finding above). Still no transaction of any kind; an earlier recipe/an earlier step within one recipe can already be committed when a later one fails. |
| `saveProjectSites` | `projects` (upsert), `project_scope_of_work` (upsert), `project_bom_lines` (delete + reinsert), `inventory_items` (read-only lookup) | Projects: yes, with row-count-implied validation via `idByName`. Scope of work: **✅ fixed, commit `4ea2fd1` (2026-09-10)** — `.ok` + exact row-count (`!==`) check. BOM lines: **still open, deliberately not touched** — a row-count check can't undo the DELETE that already ran; see `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` for the reviewed, unimplemented design. |
| `saveRestoredPurchaseRequests` | `purchase_requests` (upsert) | **[SUPERSEDED 2026-09-11, see A2.2c] Historical: the fetch's result wasn't even assigned to a variable.** Now: `.ok` + exact row-count check, local only. |
| `saveRestoredProjectDocuments` | `project_documents` (upsert) | **[SUPERSEDED 2026-09-11, see A2.2c] Historical: neither the original attempt nor a 400-retry fallback's result was checked.** Now: `.ok` + exact row-count check on the single attempt; the 400-retry fallback itself was removed (migrations 068/080 both confirmed applied, so it could only mask a real error), local only. |
| `saveMovementsBuildsAllocations` | `build_transactions`, `inventory_movements`, `project_allocation_history` | **[SUPERSEDED 2026-09-11, see A2.2c] Historical: not traced this pass, flagged only as an inferred risk.** Now confirmed and fixed: all three sub-functions check their own write's response/row-count AND their prerequisite lookup responses (a failed lookup used to silently degrade to an empty map/array), local only. |

No Storage (file) operations are involved — this snapshot is purely relational data; document/photo files referenced by restored rows are not re-uploaded, only their existing `file_url`/`storage_path` references are restored (worth confirming those files still exist in Storage separately — out of scope for this pass).

**Which responses were unchecked at the time this section was written [SUPERSEDED 2026-09-11 for the restore/movements functions specifically, see A2.2c]**: every row in the table above marked "no" at the time — concretely, the per-recipe `equipment_types` update, `purchase_requests`, and `project_documents` (both attempts), plus `project_bom_lines`' delete-then-reinsert (still genuinely unfixed, no transaction, see above — this part of the sentence remains current). `inventory_balances` and `project_scope_of_work` were fixed 2026-09-10 (commit `4ea2fd1`); `saveRestoredPurchaseRequests`/`saveRestoredProjectDocuments`/`saveBuildTransactions`/`saveInventoryMovements`/`saveProjectAllocations` were fixed locally 2026-09-11 (task 5, see A2.2c) and are no longer part of this list either. This is the same failure class as the now-fixed `createProjectFromClosedWonQuote`, just spread across the remaining functions — `project_bom_lines`' delete-then-reinsert is the one entry in this original list still genuinely open today.

**Transaction limitations**: there is no database transaction around any of this — `restoreFullBackupSnapshot` is roughly a dozen separate PostgREST calls across potentially several seconds, each independently committed the instant it succeeds. A failure on call 8 of 12 leaves calls 1-7's data committed and 9-12 never attempted. This mirrors exactly what migration 127 fixed for project conversion, but at a larger scale (six different entity types, not one), and it's a much harder shape to make fully atomic — a single Postgres transaction cannot span this many unrelated tables cleanly if any individual insert can legitimately fail (a bad SKU, a stale FK) without aborting the whole restore.

**Partial-restore failure behavior today**: completely silent. `restoreFullBackupSnapshot` returns `Promise<void>` with no aggregated result; whatever UI calls it presumably shows one blanket "Restore complete" regardless of how many of the ~6 sub-steps' ~15+ individual writes actually took effect.

**Idempotency and retry behavior**: every upsert used here keys on a stable natural or primary identifier (`sku`, `project_name`, `equipment_name`, `id`) with `on_conflict=...` — so re-running the whole restore a second time is generally safe and won't create duplicates. The one exception worth flagging: `project_bom_lines`' delete-then-reinsert has no such protection *between* the delete and reinsert of a single run — if the process dies between those two statements, a retry starts from "no BOM lines for this project" rather than "the old ones," which is recoverable (the retry reinserts from the snapshot) but means a crash mid-restore can transiently show an empty BOM until the retry completes.

**Recommended implementation, in priority order:**
1. **Check every response.** The mechanical part: add `.ok` checks (and, matching `saveInventoryItems`' own item-write precedent, row-count checks where `return=representation` is already used) to every currently-unchecked call listed above. This alone turns "silent" into "at least throws/logs," even before any UI work.
2. **Give `restoreFullBackupSnapshot` a real return type.** Replace `Promise<void>` with a structured result: `{ restored: Record<EntityType, number>; skipped: Record<EntityType, number>; failed: Array<{ entityType: string; identifier: string; reason: string }> }`. Each sub-save function needs the same shape change (mirroring how `createProjectFromClosedWonQuote` now returns `ProjectConversionOutcome` instead of `boolean`/`void`).
3. **A reconciliation report, shown to the user, not just logged.** After every sub-step, compare "how many rows did the snapshot say to restore" against "how many did the server confirm were written" (via the row-count-on-`return=representation` pattern already proven in `saveInventoryItems`). Surface as: "Restored 412 of 415 inventory items, 38 of 38 projects, 12 of 15 purchase requests — 6 records could not be restored, listed below" with the specific failed records named (SKU/project name/request number), not just a count.
4. **Plain-language failure surfacing.** Given this runs after a real incident, the message needs to be unambiguous about *what to do next*, not just what happened: "Restore mostly succeeded, but 3 inventory items and 3 purchase requests did NOT restore (listed below). Do not assume your data is fully back until you've reviewed this list. Contact support with this list if you need help." — modeled on the same "never claim complete when it isn't" principle migration 127 now enforces for project conversion.
5. **Idempotent, safely-retryable by construction** (already mostly true via `on_conflict` keys) — explicitly finish the BOM-lines delete/reinsert gap (option: don't delete until the reinsert has already succeeded, i.e. reinsert-then-delete-old, or wrap just that one project's pair in a single RPC call the way migration 127 does for a full conversion).
6. **Tests required before any implementation** (none of this should ship without): (a) a unit test per sub-save function asserting a checked-response failure surfaces in the result object rather than being swallowed; (b) a test that a full restore with one deliberately-failing sub-step still completes the *other* independent sub-steps and reports the specific failure, rather than aborting everything or hiding the one failure; (c) a test that re-running a restore twice (full idempotency) produces the same end state and the same reconciliation counts, not accumulating duplicates; (d) a test for the BOM-lines delete/reinsert specifically, once its ordering is fixed, proving a simulated failure mid-pair doesn't leave a project's BOM permanently empty.

**Full write-order trace and the safest resumable/checkpoint design (task 8 of the 2026-09-11 overnight local-only pass — design only, nothing implemented, extends this same section rather than a competing document):**

Execution order, confirmed by re-reading `persistence.ts:7336-7370` directly (unchanged since the original A2.2 trace, current line numbers shift slightly with this pass's other edits but the order does not): (1) `saveInventoryItems` — items then balances, both now real-verified and throwing as of `4ea2fd1`/tonight; (2) `saveDeviceRecipes` — now fully real-verified and throwing as of tonight's local-only fix; (3) `saveProjectSites` — projects and scope-of-work now real-verified and throwing (`4ea2fd1`), BOM lines still unverified/non-atomic (see the write map above); (4) `saveRestoredPurchaseRequests`; (5) `saveRestoredProjectDocuments`; (6) `saveMovementsBuildsAllocations`. None of the calls are wrapped in their own `try/catch` inside `restoreFullBackupSnapshot` — a throw from any step propagates straight out of the whole function (confirmed by direct trace, and by this session's own regression tests proving exactly this propagation for steps 1-3).

**What changed about this trace's own conclusions, now that steps 1-3 throw**: before tonight, `restoreFullBackupSnapshot` could report false success no matter which step's write silently failed, because nothing it called ever threw. As of tonight (local only, not deployed), a real failure in steps 1-3 now correctly aborts the whole restore with a real thrown error — **which is strictly better than before, but is not yet the reconciliation-report design in items 2-4 above**: today, a thrown error from (say) step 2 means steps 4-6 never even attempt to run, even though they're independent of step 2 and could have safely proceeded. This is the same "all-or-nothing on the first failure" tradeoff already accepted for `saveDeviceRecipes` and `saveProjectSites` individually (see their own entries above) — deliberately chosen over silent partial success, but it does mean a single failing entity type currently blocks every later, unrelated entity type in the same restore, which recommendation 6(b) above already flags as a gap the *real* implementation (structured per-step results, not per-step throwing) should close.

**Resumability — corrected 2026-09-11 (same day, review): a full retry is a promising direction, not a proven one. Do not describe it as already safe or as producing the same end state.**

The original version of this section claimed every sub-save is a natural-key upsert and that re-running the entire restore a second time therefore "re-applies already-applied rows harmlessly," concluding a persisted checkpoint/resume mechanism was unnecessary. That conclusion was too strong — it's true for some of what this restore touches, and confirmed false or unverified for other real parts of it:

1. **`project_bom_lines`' delete-then-reinsert creates brand-new row ids on every run**, restored or not (no `id` is preserved across the delete/insert pair — see `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §2a). A second restore attempt does not reproduce the *same* BOM line identities, only equivalent-looking content (same `item_name`/`qty`).
2. **`task_hardware_dependencies.project_bom_line_id` can lose its reference** as a direct consequence of (1) — the FK's `ON DELETE SET NULL` fires every time the BOM lines it points at are deleted and recreated with new ids, restore or ordinary save alike (confirmed dormant today only because nothing currently populates that column with a real value — see the BOM plan document; that doesn't make a restore retry safe, it makes today's specific data unaffected by the gap).
3. **`saveRestoredProjectDocuments` regenerates `document_number` from `Date.now()` on every call** (`persistence.ts`, `DOC-RESTORE-${Date.now().toString(36).toUpperCase()}-${index}`) — confirmed by direct read. The underlying row is correctly upserted by its stable `id`, but the document number itself is a **new, different value on every restore attempt**, including a retry of the exact same snapshot. This alone disproves "retrying produces the same end state" as a general claim about this restore.
4. **[SUPERSEDED 2026-09-11, see A2.2c] `saveRestoredPurchaseRequests` and `saveRestoredProjectDocuments`'s own POST calls remain entirely unchecked** (bare `await fetch`, no `.ok` check, confirmed by direct read) — true when this section was written (neither this pass nor the `4ea2fd1` pass had touched them yet); both were fixed locally 2026-09-11 (task 5, then corrected same day to also remove `saveRestoredProjectDocuments`'s stale 400-retry fallback). A retry's own success IS now verifiable for these two steps (each throws a real error on a checked failure) — this does not by itself resolve the identity/timestamp concerns below, which remain open.
5. **Timestamps and other generated values** (`uploaded_at` defaulting to `new Date().toISOString()` when a snapshot doesn't carry one, `created_at` passthrough vs. generated, and any other server-assigned value not carried verbatim in the snapshot) can differ between attempts for the same underlying record.

**Revised conclusion**: a full retry (re-running the whole restore against the same uploaded snapshot) is a **promising recovery direction for the top-level natural-key records that are cleanly keyed** (`inventory_items` by `sku`, `equipment_types` by `equipment_name`, `projects` by `project_name`) — those genuinely look idempotent on direct inspection. It is **not proven end-to-end**, and specifically not proven for BOM line identities, dependent foreign keys, generated document numbers, or the two still-unchecked restore writes above. **Checkpoint/resume design stays open, not closed or rejected**, until a real end-to-end retry test exists that verifies: the restored *content* matches on a second attempt, row *identities* are stable or the instability is deliberately accepted and documented, dependent foreign keys (`task_hardware_dependencies` and any other future FK into a restored/regenerated table) survive or are correctly re-pointed, and no duplicate rows accumulate from running the restore twice. None of that test exists yet — this document does not claim it does.

This remains a plan only — no code for this was written or run, per the explicit instruction to audit and design, not implement or run a restore.

### A2.2c Restore hardening — fresh trace, confirmed findings, and the checkpoint/reconciliation design (task 5, 2026-09-11, plus a same-day correction pass after review)

**Fresh, direct re-read of `restoreFullBackupSnapshot` (`persistence.ts:7663-7697`) and every function it calls, current source, not assumed from A2.2's prior trace.** The write order and dependency chain A2.2 already documented are unchanged and re-confirmed. Two things were new in the initial task-5 pass: (1) `saveMovementsBuildsAllocations`'s three sub-functions, previously flagged only as "not traced this pass — an inferred risk," were traced directly and the same unchecked-write pattern became a **confirmed finding**, not an inference; (2) those three functions' unchecked writes, plus the two restore-only functions' unchecked writes, were fixed as isolated response checks. **A same-day review then found the initial pass incomplete**: it checked each function's own write, but not the prerequisite lookups those writes depend on, and left a stale 400-retry fallback in `saveRestoredProjectDocuments` that could mask a real error. Both are corrected below — this section now reflects the corrected, final state, not the initial pass. Neither pass is the full workflow redesign, which stays design-only further below.

**✅ RESOLVED LOCALLY, NOT DEPLOYED — five restore/live-save write functions, in two passes (2026-09-11 task 5, then a same-day correction pass after review):**

| Function | Line (approx.) | Before | After (final, post-correction) |
|---|---|---|---|
| `saveRestoredPurchaseRequests` | `persistence.ts` | POST result not even assigned to a variable — no `.ok` check of any kind | `.ok` + exact row-count check, throws `"Some purchase requests could not be restored."`, real detail logged |
| `saveRestoredProjectDocuments` | `persistence.ts` | First attempt checked only enough to decide whether to retry on 400; a non-400 failure and the fallback retry's own result were both silently discarded | Task 5 pass added `.ok`+row-count checks to both the attempt and the 400-fallback retry. **Correction (same day, review): the 400-fallback retry itself was removed entirely**, not just checked — migrations 068 (`uploaded_by_email`) and 080 (`purchase_order_id`/`purchase_request_id`) are both confirmed applied in production, so retrying on any 400 after stripping a column could only turn an unrelated validation error into a second request that silently omitted provenance and reported success. Every non-OK response (400 included) is now a real, reported, non-retried failure. `purchase_order_id`/`purchase_request_id` were also added to the restore payload itself (traced against the live per-document create path, which already writes both) — a real, previously-missing field, not a speculative addition. |
| `saveBuildTransactions` | `persistence.ts:6122` | POST result not assigned — no check; the prerequisite `equipment_types` lookup silently degraded to an empty map on failure | Task 5 pass added `.ok`+row-count check to the write. **Correction (same day, review): the `equipment_types` lookup is now also checked** — an HTTP/network failure on it throws before any write, instead of silently writing every build with a null equipment reference. A genuinely unmatched equipment NAME (the lookup itself succeeded) still resolves to null, unchanged this pass — `equipment_type_id`/`finished_inventory_item_id` being nullable FKs (migration 003, no `not null`) only proves the DATABASE permits a null value here, not that saving a null reference for an unmatched name is the product's intended behavior. That's preserved as-is, not decided, and is flagged below as a documented future data-quality question, not settled by this pass. |
| `saveInventoryMovements` | `persistence.ts:6226` | POST result not assigned — no check; all three prerequisite lookups (`inventory_items`, `projects`, `build_transactions`) silently degraded to `[]` on failure; a movement with a nonempty, genuinely unresolved sku was silently filtered out of the write with no error; a movement with a missing/blank sku was also silently filtered out | Task 5 pass added `.ok`+row-count check to the write only. **Correction (2026-09-11, review), the substantive fix**: all three lookups now throw on an HTTP/network failure before any write. A movement with a nonempty sku that doesn't resolve to a real `inventory_items` row now rejects the WHOLE save up front (before any write), naming the unresolved sku/movement — `inventory_item_id` is NOT NULL on `inventory_movements` (migration 001, confirmed by direct schema read), so this could never have been written anyway. **Further correction (2026-09-11, review): a movement with a missing or whitespace-only sku is now ALSO rejected the same way**, checked before any lookup or write at all, since a blank sku can never resolve regardless of whether any lookup succeeds — this needed no product decision, only the `NOT NULL` constraint. `project_id`/`build_transaction_id` remain nullable FKs (migrations 001/021/075) — a genuinely unmatched project/build NAME still safely resolves to null, preserved as-is this pass. That FK being nullable proves the database permits it, not that it's the intended product rule; see the data-quality note below. |
| `saveProjectAllocations` | `persistence.ts:6284` | POST result not assigned — no check; all three prerequisite lookups silently degraded to `[]` on failure | Task 5 pass added `.ok`+row-count check to the write. **Correction (same day, review): all three lookups now throw on an HTTP/network failure before any write.** Unlike `saveInventoryMovements`, `project_id`/`inventory_item_id`/`movement_id` are ALL nullable FKs on `project_allocation_history` (migration 003, confirmed by direct schema read — none is NOT NULL) — a genuinely unmatched name/sku/legacy-id still safely resolves to null here, preserved as-is this pass, not evaluated as a product decision (see the data-quality note below). Only the lookup's own HTTP/network failure is new grounds for rejection. |

**Why this was safe to implement, per this pass's own boundary ("implementation allowed ONLY for isolated response checks whose callers already handle thrown errors correctly")**: every one of these five functions has exactly two possible call paths, and both already handle a thrown error honestly, confirmed by direct trace, not assumed —
1. **The restore path**: all five are only ever reached through `restoreFullBackupSnapshot`, whose only caller (`main.tsx`, `handleImportBackup`'s `reader.onload`) already wraps the call in a real `try/catch` with a message that does not overclaim success: *"Backup restore did not complete. Some information may already have been restored. Review the data before trying again."*
2. **The live-save path** (`saveBuildTransactions`/`saveInventoryMovements`/`saveProjectAllocations` only — the other two are restore-only, confirmed by a repo-wide grep finding no other call site): these three are also the live debounce-save path for builds/movements/allocations, reached via `saveMovementsBuildsAllocations`. **Correction (same day, review): this catch used to discard the caught error and show a message naming RLS/env vars/login — now it logs the real error via `console.error` and shows only a plain operational message** ("Some inventory history could not be saved. Try again. If the problem continues, contact support.") — confirmed by direct read of the corrected `main.tsx` handler, not assumed.

**Test totals across both passes (corrected count, 2026-09-11 — an earlier draft of this line miscounted)**: 25 tests in `src/task5-restore-write-verification.test.ts` after this correction pass (16 from task 5, +9: 2 for the `equipment_types` lookup failure, 4 for `saveInventoryMovements`'s three lookup failures plus the unresolved-sku preflight, 3 for `saveProjectAllocations`'s three lookup failures — `saveRestoredProjectDocuments`'s block was rewritten, not net-added-to, to prove the 400-no-retry/exactly-once/provenance-preserved behavior instead of the old fallback). `ensureTeamMemberForSelf`'s existing test in `src/task2-unchecked-write-fixes.test.ts` was also corrected (see below). Full suite: **270/270 passing** (was 261 before this correction pass, 245 after task 2, 223 at the original baseline). **Not committed, pushed, or deployed.** (A further 2026-09-11 pass adds 3 more tests for the blank-sku preflight — see below in this same section — bringing the file to 28 and the full suite to 273.)

**Precise status, so a later reader cannot conflate these into one claim:**
- **Response verification** (the write's own `.ok`/row-count check) — added locally for all five functions, task 5.
- **Prerequisite lookup failures** (the reads each write depends on) — corrected locally for all five functions, same-day correction pass; a lookup's HTTP/network failure is now a hard stop before any write, for every one of the five. A movement with a missing/blank sku is also now rejected the same way, before any lookup at all (2026-09-11 correction) — this one needed no product decision, since `inventory_item_id` simply cannot be null.
- **Multi-step saves remain non-atomic.** None of this makes `restoreFullBackupSnapshot` itself, or any multi-table sequence within it, transactional — a failure on step N still leaves steps 1..N-1's writes committed. That is unchanged by tonight's work and is the subject of the still-open checkpoint/reconciliation design further below, not something this pass's fixes resolve.
- **Unresolved OPTIONAL associations: DECIDED (2026-09-11, E) — NOT YET IMPLEMENTED.** E's decision: show a warning and require correction, rather than quietly saving a missing project, build, or equipment link. This resolves the open question the prior wording correction (below, preserved for history) explicitly flagged rather than answered. **As of this decision, the code has not changed** — `saveBuildTransactions`' unmatched equipment name and `saveProjectAllocations`'/`saveInventoryMovements`' unmatched project/build names still resolve silently to `null` exactly as before; implementing the warning-and-require-correction flow needs its own scoping (which screens surface the warning, whether it blocks the save outright or lets the user proceed after acknowledging, and how "correction" is presented for each of the three call sites) that has not been done. Not named as the next or second implementation priority (see the equipment-recipe and Project BOM priorities below) — queued, not scheduled.
  - *(Preserved for history — the prior wording correction this decision now answers):* an earlier draft of this section described the silent-null behavior as "documented behavior" and "schema-valid, documented" as if a nullable FK settles the question. It doesn't — a nullable FK proves only that the DATABASE will accept a null value here, not that silently saving one is what the product wants. That correction stopped short of deciding the question; E's decision above now does.
- **No production verification has occurred.** Every fix above and its tests run only against a mocked `fetch` in Vitest. None of it has been run against a real Supabase instance, staging or production.

**Also corrected, same day: `ensureTeamMemberForSelf` (`persistence.ts:3194`).** It used to log a failed `team_members` lookup and then proceed to the INSERT anyway — once the lookup itself failed, the function has no way to know whether the member already exists, so proceeding risked a duplicate row or a confusing unique-constraint error logged as an insert problem. Now returns immediately after logging a failed lookup, making exactly one request in that case; stays best-effort/non-throwing, unchanged. Test updated to assert exactly one request and no insert attempt on a failed lookup.

**The prior version of this document's "still-open finding" for `saveInventoryMovements`'s unresolved-sku behavior is now RESOLVED, not open** — see the table above. The gap was real (a movement with a genuinely nonempty, unresolved sku was silently dropped with no error), and it is now a loud, whole-save rejection instead. **A second, related gap — a movement with a missing or whitespace-only sku, also silently dropped — was found and fixed the same way in a 2026-09-11 correction pass**: checked before any lookup or write at all, since a blank sku can never resolve to anything. Neither of these needed a product decision — `inventory_item_id` is `NOT NULL`, so a movement that can't resolve a sku (blank or unmatched) genuinely cannot be written; rejecting it is the only correct behavior the schema allows. The reconciliation-report design below still independently matters for a different reason: it would surface a **dry-run-time** preview of which records would be skipped/rejected, before a restore is even attempted, which today's mechanical fix does not provide — a restore still has to actually run (and fail) to discover an unresolved sku today.

**Hardened design — checkpoints/resume tokens, structured per-step results, dry-run validation, final reconciliation report, admin-visible failure reporting, and safe synthetic-data testing.** This extends, not replaces, A2.2's existing "recommended implementation, in priority order" list and the "resumability" conclusion above (still accurate: a full retry is promising for cleanly-keyed top-level records, not proven end-to-end). Design only — nothing below is implemented.

1. **Per-step structured result, not a thrown error per step.** Replace `restoreFullBackupSnapshot`'s `Promise<void>` (and each sub-save's own `Promise<void>`) with a shared shape:
   ```ts
   type RestoreStepResult = {
     step: "inventoryItems" | "deviceRecipes" | "projectSites" | "purchaseRequests" | "projectDocuments" | "movementsBuildsAllocations";
     attempted: number;
     restored: number;
     skipped: Array<{ identifier: string; reason: string }>; // e.g. an unresolved sku, an ambiguous name
     failed: Array<{ identifier: string; reason: string }>;  // a real thrown/caught error for this specific record or sub-step
   };
   type RestoreOutcome = { steps: RestoreStepResult[]; startedAt: string; finishedAt: string; snapshotId: string };
   ```
   Every sub-save function is wrapped in its own `try/catch` **inside** `restoreFullBackupSnapshot` (not left to propagate and abort the whole function, as it does today) so one step's failure is recorded and the *next independent* step still runs — directly closing the gap A2.2 already flagged ("a single failing entity type currently blocks every later, unrelated entity type in the same restore").
2. **Checkpoints/resume tokens.** A `snapshotId` (a hash of the uploaded file's content, or a user-supplied label) plus a small persisted record — **not** a new table without a migration; for tonight's design-only purposes, this can be `localStorage`-backed client-side state, since a resume token only needs to survive a page reload during the SAME restore attempt, not become shared/multi-device state — of which steps in `RestoreOutcome.steps` have already reached `restored === attempted` (fully clean) for this `snapshotId`. A resumed restore **skips** any step already fully clean and re-attempts only steps that were partially or fully failed, rather than re-running everything (safe either way per A2.2's idempotency analysis for the cleanly-keyed steps, but wasteful and slower to redo them). A step that was *partially* restored (some records succeeded, some failed) is always fully re-attempted, not "topped up" — re-running its already-succeeded records is the safe, natural-key-upsert behavior A2.2 already established, not a new risk.
3. **Dry-run validation — a real pass with no writes, before the real restore.** Before executing anything, run every step's own resolution/validation logic (name/sku lookups, enum value checks, referential checks) **without any POST/PATCH**, producing a `RestoreOutcome`-shaped preview: "this snapshot would restore 412 inventory items, 38 projects, and would SKIP 3 purchase requests (unresolvable project name) and 1 movement (unresolvable sku) — nothing has been written yet." This directly requires the same up-front "resolve first, write second" ordering `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`'s reconcile-by-id RPC already uses (§3 steps 4-5 there) — validate everything, THEN write — applied here at the whole-restore level instead of one RPC's scope. The user reviews the dry-run report and explicitly confirms before the real, writing pass runs.
4. **Final reconciliation report, shown to the user, not just logged** — same shape A2.2 item 3 already specified, now grounded in the structured per-step result from item 1 above rather than a hypothetical: *"Restored 412 of 415 inventory items, 38 of 38 projects, 12 of 15 purchase requests, 0 of 1 inventory movement — 6 records could not be restored, listed below with the specific reason for each."* Every `skipped`/`failed` entry names the record (SKU/project name/request number/movement id) and the specific reason, not a generic count.
5. **Admin-visible failure reporting, not just a toast the user closes.** The `RestoreOutcome` (from item 1) is the natural input to the System Health proposal being refined in this same overnight pass (§A2.3, task 8) — a restore that ends with any non-empty `failed` array should record a System Health entry (e.g. "Backup restore stopped after Project Documents — 3 records failed") so an admin who wasn't the one running the restore still finds out, not just the person watching the screen at the time. This document does not implement that link tonight — it is named here so the two designs (this one and §A2.3) are built compatible with each other, not as two competing shapes for the same underlying problem.
6. **Safe synthetic-data testing, in a rolled-back transaction — the concrete way to test this without touching real data.** A.2.2's own "tests required before any implementation" list already named the right test *cases*; this adds the mechanism for running them safely: every proposed test (a full restore with one deliberately-failing sub-step; a duplicate/idempotent re-run; the BOM-lines delete/reinsert edge case) should run against synthetic rows created and destroyed inside a single database transaction that is always rolled back at the end (`BEGIN; ... test assertions ...; ROLLBACK;`, the same pattern already used for exploratory schema checks elsewhere in this session), or against a genuinely separate test/staging Supabase project if one exists — **never against production data**, and never by writing-then-manually-deleting rows in production, which risks leaving artifacts behind on a crashed test run. This is a testing-infrastructure requirement this document did not previously spell out explicitly, even though "tests required before any implementation" was already stated.

None of items 1-6 above are implemented tonight — this section is a design extension of A2.2's existing recommendations, not new functionality. The code changes from this pass are: the five functions' write-response checks and prerequisite-lookup checks (the table above), `ensureTeamMemberForSelf`'s stop-after-failed-lookup fix, and the live movements/builds/allocations `main.tsx` catch's corrected error message (see above) — nothing else in this section is implemented.

### A2.2a Targeted unchecked-write scan — ranked findings (task 9, 2026-09-11 overnight local-only pass)

Fresh, direct re-read of every function named in this document's own §5 list (the original "fetch calls that never inspect `response.ok`" catalogue), current line numbers confirmed against today's source, excluding everything already resolved above (`saveInventoryItems` — both writes; `saveProjectSites` — projects/scope-of-work; `saveDeviceRecipes`; `recordNotificationDelivery`; `addTaskActivity`) and `createProjectFromClosedWonQuote` (superseded entirely by migrations 127/128).

**Attempted, then reverted after review (2026-09-11, same day)**: `updateProjectLedgerInfo`, `updateInstalledAsset`, and `updateProjectStakeholder` were given the same `.ok` + row-count fix as everything else in this section, with their `main.tsx` callers (`handleUpdateProjectLedgerInfo`/`handleUpdateInstalledAsset`/`handleUpdateProjectStakeholder`) changed to capture the prior array state and restore it on a caught failure. **This was reverted, not shipped.** The revert-on-failure design was unsound: capturing "the array as it was" inside a React state-updater callback and restoring that exact array later is not a safe concurrency primitive — if a second edit lands while the first request is still in flight, an older failed request's revert can overwrite the second edit's already-applied change with stale data, silently erasing real work rather than protecting it. This needed a deliberate concurrency-safe design (e.g. reverting only the specific field that failed, not the whole array, or a per-id in-flight guard), not a same-night mechanical fix. Separately, code tracing found two of the three writers are not actually live today: `handleUpdateInstalledAsset` has **no call site anywhere in `main.tsx`** (confirmed by grep — only its own definition matches), and `onUpdateProjectStakeholder` is passed as a prop into `<Projects>` but is not actually invoked by anything inside that component or its children. `updateProjectLedgerInfo`'s caller does appear to be live-wired. All three functions are confirmed to still have the original unchecked-write gap described below — this correction is about the fix's own safety and the caller-liveness claim, not about the underlying finding being wrong.

**Fresh re-read completed 2026-09-11 (task 2, overnight autonomous pass) — every function below was re-read directly in current source, not assumed from this table's own prior line numbers (several had drifted).** Six were confirmed genuinely safe to fix mechanically tonight (each already had, or was given, a real caller-side visible-error path with no array-rollback risk); the rest were confirmed to need a caller-side design decision first, or are dead code, and were deliberately left unfixed with the specific reason recorded per function.

**✅ RESOLVED LOCALLY, NOT DEPLOYED (2026-09-11) — the six safe-to-fix-tonight functions:**

| Function | Line | Fix | Caller change |
|---|---|---|---|
| `updateSalesQuoteInfo` | `persistence.ts:11091` | `.ok` + exact row-count check, plain message, real detail logged | **Corrected 2026-09-11 (review): originally optimistic, unchanged on failure (see the struck-through note below); now pessimistic** — `handleUpdateSalesQuoteInfo` awaits the persistence call first and applies `setSalesQuotes` only after it succeeds, so a failed save never leaves an unsaved value displayed as if it had saved. `setSalesQuoteStatus` (a rendered status string, confirmed via its `status={salesQuoteStatus}` render prop) still shows on failure. |
| `updateFormSchemaField` | `persistence.ts:4053` | Same | Both callers (`handleUpdateFormField`, `handleUpdateSiteIntakeField`) wrapped in `try/catch`, reusing the exact `setFormBuilderStatus`/`setSiteIntakeFormBuilderStatus` pattern their own sibling "add" handlers already use one function above them. Neither caller applies its local state update until *after* the persistence call succeeds (not optimistic), so there was no revert-safety question here at all. |
| `updateSiteHardwareRule` | `persistence.ts:4376` | Same | **Corrected 2026-09-11 (review): originally optimistic, unchanged on failure (see below); now pessimistic**, matching `updateFormSchemaField`'s already-correct shape — `handleUpdateSiteHardwareRule` awaits the write first, applies `setSiteHardwareRules` only after success. `setSiteHardwareRuleStatus` still shows on failure. |
| `updateVendor` | `persistence.ts:8155` | Same | **Corrected 2026-09-11 (review): same fix as `updateSiteHardwareRule`** — `handleUpdateVendor` now awaits the write first and applies `setVendors` only after success; it also no longer touches local state at all when there is no authenticated session (it previously updated the UI unconditionally, session or not). `setVendorStatus` still shows on failure. |
| `updateSalesQuoteBomLineCatalogLink` | `persistence.ts:9205` | Same | **Corrected 2026-09-11 (review): same fix** — `handleUpdateSalesQuoteBomLineCatalogLink` now awaits the write first, applies its `setSalesQuotes` update only after success. Cosmetic/bookkeeping field, not the BOM line's core content, but still worth not showing as saved when it wasn't. `setSalesQuoteStatus` still shows on failure. |
| `deleteSalesQuoteBomLinesByLocationSource` | `persistence.ts:9195` (comment block above it) | `.ok` check, plain message, real detail logged | None needed — the one caller (`handlePullLocationHardwareIntoQuoteBom`) already wraps this **and** the subsequent insert in one `try/catch` → `setSalesQuoteStatus`. **Explicitly does not close the underlying delete-then-reinsert atomicity gap** — if this delete succeeds and the following insert then fails, the location-sourced BOM lines are still gone with nothing re-inserted, the same class of risk `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` documents for `saveProjectSites`. This fix only makes the delete's own failure visible, nothing more. |

Also: **`ensureTeamMemberForSelf` (`persistence.ts:3194`)** — logging only, stays best-effort/never-throws by design (matching the `recordNotificationDelivery`/`addTaskActivity` precedent from the prior pass): both the lookup and insert now log a real failure via `console.error` instead of vanishing inside the bare `catch {}`.

**Correction (2026-09-11, review): the "optimistic update, no revert" posture described above for `updateSiteHardwareRule`/`updateVendor`/`updateSalesQuoteBomLineCatalogLink`/`updateSalesQuoteInfo` was reviewed again and changed.** It was safe (never introduced an array-rollback race), but it still left a real problem: on a failed save, the unsaved value stayed on screen looking exactly like a saved one, with only a status message — easy to miss — as the sign anything was wrong. All four callers are now pessimistic: the local state update happens only after the persistence call succeeds, and on failure the value simply never changes (nothing to revert, since nothing was applied yet) while the existing status message still shows. This is not the array-snapshot-restore pattern this session has repeatedly ruled unsafe — it sidesteps that whole class of concurrency risk by never touching local state before confirmation, rather than reverting a stored snapshot after the fact. `handleUpdateVendor` additionally no longer updates local state at all with no authenticated session (previously unconditional). **This repository has no component/handler test harness** (confirmed — no React Testing Library, no equivalent, in `package.json`); these four changes were verified by direct code trace, not by an automated test, and no UI-testing dependency was added to close that gap. Form-field handlers (`handleUpdateFormField`, `handleUpdateSiteIntakeField`) already used this exact server-first sequence and were left unchanged.

22 new tests, `src/task2-unchecked-write-fixes.test.ts`. **Not committed, pushed, or deployed.**

**Confirmed, documented, NOT fixed — needs a caller-side design decision, dead code, or is already self-healing (ranked; every reason below is specific, not a generic "left for later"):**

| Function | Line | Severity | Real-world example | Why not fixed tonight |
|---|---|---|---|---|
| `updateProjectLedgerInfo` | `persistence.ts:7185` | **Medium-High** | A PM sets a project's warranty-expiration date; an RLS hiccup drops the write; the date shown looks "saved" but the Client Ledger's EOL tracking is quietly wrong until someone notices during an actual warranty claim. | **Attempted and reverted 2026-09-11**, confirmed still live (`handleUpdateProjectLedgerInfo`, wired via `ClientLedger`'s bucket/kickoff/warranty-date editors) with **no safe caller path today** — no try/catch at all, optimistic whole-array `setProjectLedgerInfo` update with no revert. This is the one the audit's own prior finding explicitly flags as needing a genuinely different design (revert only the single field that failed, or a per-id in-flight guard), not a repeat of the reverted array-snapshot pattern — exactly the boundary this pass was told to stop and design around rather than reattempt. |
| `updateTaskHardwareDependencyStatus` | `persistence.ts:4465` | **Medium-High** | A hardware dependency is marked `allocated`/`procurement_queued` for a task; a silent failure leaves warehouse/purchasing looking at a stale status, so the task appears blocked or ready when it isn't. | Caller (`runTaskHardwareAutomation`) is invoked **fire-and-forget, not awaited, with no `.catch`**, from `handleUpdateTask`. A mechanical throw here would become a genuine **unhandled promise rejection**, a new failure mode worse than today's silent no-op, not a visible one. Also multi-step: an inventory allocation or a real purchase-request row can already be committed by the time this status PATCH runs, so even a safe throw wouldn't undo that. Needs the orchestration loop wrapped in its own try/catch first — a caller-side decision, not attempted. |
| `updateSalesQuoteLocation` / `updateSalesQuoteLocationItem` | `persistence.ts:9209` / `9302` | **Medium-High** | A Sales quote's site details or a location's hardware line silently fails to update; the quote presented to (or already sent to) a customer doesn't match what was actually entered. | Both callers optimistically update `setSalesQuotes` (a whole-array update) with **no try/catch at all** — the exact same unsafe shape the three reverted functions were caught doing, just not yet attempted here. Needs the same deliberate concurrency-safe design before either is touched, not a copy of the reverted pattern. |
| `updateProjectLocation` / `updateProjectLocationItem` | `persistence.ts:9788` / `9944` | **Medium-High** | Same shape, post-conversion — a project location's install details silently don't save, and field crews work from stale information. | Identical reason — both callers optimistically update `setProjectSites` (whole-array) with no try/catch. Same design work needed first. |
| `markNotificationRead` / `markAllNotificationsRead` | `persistence.ts:3328` / `3340` | **Low** | The notification bell's unread badge silently doesn't clear — reappears or stays stuck; annoying, self-corrects on the next real notification or reload. | Both call sites explicitly do `.catch(() => {})` — a **deliberate swallow**. A mechanical persistence-layer fix alone accomplishes nothing here; the `.catch(() => {})` itself would need to be replaced with real handling first, which is a caller-side decision (what should happen to the optimistic "read" flip on failure?), not a technical afterthought. |
| `removePushSubscription` | `persistence.ts:1840` | **Dead code** | N/A — no caller anywhere in the repo, not even a wrapper handler (confirmed by a repo-wide grep, not just `main.tsx`). "Turning off push notifications" isn't wired to any UI action today. | Not worth fixing until a real "disable push on this device" path is built to call it. |
| `addDirectMessageReaction` / `removeDirectMessageReaction` / `addChannelMessageReaction` / `removeChannelMessageReaction` | `persistence.ts:1173/1184/1664/1675` | **Low** | An emoji reaction silently doesn't add/remove — immediately visible and re-clickable, no data at risk. | No caller has a try/catch, so a mechanical throw would be a new unhandled rejection — but both the DM thread and channel view already re-poll every 5 seconds specifically because of this class of drift (confirmed via the existing code comment at each poll site: "reconciled by the next 5s poll either way"), so the practical failure is already self-healing within 5 seconds regardless. Low urgency either way. |
| `updateInstalledAsset` | `persistence.ts:7306` | **Dead code** | N/A | **Attempted and reverted 2026-09-11.** `handleUpdateInstalledAsset` still has **no call site anywhere in `main.tsx`** — confirmed dead code, not just an unverified write. Fixing the persistence layer alone has zero runtime effect until this is separately wired up, which is out of scope ("do not revive or wire dead handlers merely to test them"). |
| `updateProjectStakeholder` | `persistence.ts:7441` | **Dead code** | N/A | **Attempted and reverted 2026-09-11.** `onUpdateProjectStakeholder` is passed into `<Projects>` as a prop and destructured, but grep for an actual invocation (`onUpdateProjectStakeholder(`) returns zero matches anywhere — confirmed dead wiring, same conclusion as `updateInstalledAsset`. |

**Explicitly not reviewed for fixing this pass, per this session's own standing boundary** (not a severity judgment — a scope one): `updateHandoverResponses` (`persistence.ts:4162`) and `submitHandover` (`persistence.ts:4173`). These sit inside the Submittal/Handover workflow `HANDOFF.md` explicitly protects ("Proposals belong to Sales. Submittal responsibility may move from Sales to the assigned PM after the approved handoff conditions; do not simplify that workflow without discussion") — a response-checking fix here is very likely just as mechanical and safe as the others above, but touching code in this specific workflow without E's discussion is exactly what this pass's boundaries rule out. Flagging their existence and shape (same unchecked-fetch pattern as everything else in this list) rather than silently skipping them without a note.

**Why the list above wasn't fully fixed tonight**: 3 functions were fixed and kept (`saveDeviceRecipes`, `recordNotificationDelivery`, `addTaskActivity`); 3 more were attempted and reverted (`updateProjectLedgerInfo`/`updateInstalledAsset`/`updateProjectStakeholder`, see above); 14 more remain open and undocumented-as-attempted in the table above. Fixing all of them in one pass, each needing its own caller-side design and test file, would trade thoroughness on the ones already done for breadth across many more. This ranked list is the starting point for whoever picks the rest up next — including redesigning the caller-side revert for the three reverted ones with real concurrency safety.

### A2.2b Test-quality review (task 10, 2026-09-11 overnight local-only pass)

Reviewed every test file added tonight (`src/inventory-and-project-write-verification.test.ts` extended; `src/device-recipes-write-verification.test.ts`, `src/notification-delivery-logging.test.ts`, `src/single-record-update-verification.test.ts`, `src/task-activity-logging.test.ts` all new) plus the two files from the prior day's pass, specifically for the four risk classes named:

1. **Order dependence / cached module state.** `grep -n "^let " src/persistence.ts` confirms exactly one module-level mutable variable in the whole file: `mainWarehouseLocationId` (the warehouse-location-id cache `getMainWarehouseLocationId` memoizes). Only `inventory-and-project-write-verification.test.ts` exercises code that touches it, and it was already designed around this: the fetch mock there routes by **URL substring, not by call order/index** (`installFetchRouter`), so it produces the correct response for the `locations?select=...` endpoint whether it's actually called 0 or 1 times across the file's tests, regardless of which test runs first or whether the cache is already warm from an earlier test in the same file. None of tonight's four new test files touch any code path that reads this cache, so no equivalent risk exists there. No other module-level cache exists to worry about.
2. **Mock/spy accumulation across tests in one file.** Checked empirically, not assumed: a throwaway two-test file (`beforeEach` re-`vi.spyOn`s `console.error`; test A logs once and asserts one call; test B asserts zero calls with no logging of its own) confirmed **this vitest configuration does not leak spy call history between tests in the same file** — test B correctly saw zero calls despite running after test A. This matters because several of tonight's tests assert `expect(console.error).not.toHaveBeenCalled()` on a success path *after* other tests in the same file deliberately trigger failure logging — confirmed these assertions are testing real behavior, not passing by accident of accumulated-but-uninspected history.
3. **Mock realism.** The shared `respond(ok, status, body)` helper across all these files models `.ok`/`.status`/`.json()`/`.text()` — everything the code under test actually reads from a `fetch` Response. One real gap noted, not fixed: unlike a genuine `Response`, these mocks allow calling both `.json()` and `.text()` on the same mock object without the second call throwing "body already read" — real `fetch` would throw there. Checked whether this masks anything: no production code path in any of the functions touched tonight calls both on the same response (each branches into exactly one or the other, `.text()` only in the failure branch, `.json()` only in the success branch), so this permissiveness doesn't hide a real double-read bug today — flagged here so a future test author doesn't rely on it by accident.
4. **Assertions that only mirror the implementation instead of testing behavior.** Reviewed every `expect(console.error).toHaveBeenCalledWith(...)` — all use `expect.stringContaining(...)` against a meaningful substring (an entity id, a status code, an expected-vs-actual count), not a trivial "was called" check with no content assertion. The "does not retry an unrelated 400" test (`inventory-and-project-write-verification.test.ts`) asserts a real behavioral property — exact call count against the balances endpoint — not just that the mock function exists. No test found that would pass identically before and after reverting the fix it's supposed to guard (spot-checked by mentally reverting each fix and confirming its own test(s) would then fail on the throw/message/log assertion, not just on an unrelated implementation detail).

**UI behavior still lacking automated coverage** (unchanged limitation, restated precisely for this pass — this repo has no component-render test infrastructure: no `@testing-library` dependency, no render-based test anywhere, and none was added tonight per the explicit instruction not to add a component-testing package):

- The three reverted-optimistic-update handlers fixed tonight (`handleUpdateProjectLedgerInfo`/`handleUpdateInstalledAsset`/`handleUpdateProjectStakeholder`, `main.tsx`) — the revert-on-failure and `window.alert` behavior is verified by direct code reading only, not an automated test.
- Every debounced-save effect's `.catch()` (projects, inventory items, device recipes) — the `console.error` + status-pill + message behavior is verified by direct code reading only.
- `importBackup`'s catch block (the corrected "Backup restore did not complete..." message) — same.
- None of this is new to tonight; it was already true of the equivalent fixes from the prior day's pass and is restated here rather than re-flagged as if newly discovered.

### A2.3 System Health — design proposal (not built; documentation only)

Using the data sources already established as real and already-captured (per Addendum 1): `notification_deliveries` (per-channel send outcomes, migration-119-era), cron logging (`api/cron/task-overdue.js`'s existing per-run summary), rate-limit trips (`api/_lib/rateLimit.js`), and the pattern this session's own migrations 119-127 established for API failure logging (`console.error` with enough context to diagnose, never a raw stack trace to the end user).

**What should create an alert** (urgent, needs a human to look soon): a notification channel failing 3+ times in a row for the same route/channel (signal of a broken integration, not one flaky send); a cron run that failed outright (not just "found 0 overdue tasks," which is a normal empty result, but the job itself throwing); a rate-limit actor tripping the limit repeatedly across a short window (an abuse signal, not a single legitimate burst); a Redis/Upstash connection failure lasting more than one check interval (the current silent fail-open, Addendum 1).

**What's informational, not urgent** (visible on the screen, no alert): a single notification-channel failure with a normal cause (an employee's Slack account deactivated, one bounce); a cron run that completed normally with zero matching records; a single rate-limit trip from one actor (normal user behavior, not a pattern).

**What the administrator sees, in plain language**: a table, most-recent-first, of "events" — not raw log lines. Each row: **what happened** ("Slack notification delivery failed" / "Overdue-task cron run failed" / "Repeated rate-limit trips"), **who/what was affected** ("Project PRJ-0042's status-change notification" / "the nightly overdue-task scan" / "user jsmith@ergon.test on the purchase-request endpoint"), **first seen** and **most recent** timestamps (so a recurring problem is visibly recurring, not N separate unrelated rows), **how many times** (a retry/occurrence count), **current status** (Active / Acknowledged / Resolved), and a **safe action**: "Retry now" (re-attempt the specific failed send/job, where safe to do so) or "Acknowledge" (mark seen, stop it demanding attention, without claiming it's fixed). Any technical detail (a raw error message, a stack fragment, an internal table/column name) goes behind a collapsed "Technical details" disclosure, never in the primary line — matching the same "safe summary, technical detail on request" split this session's migration-127 work just established for `createProjectFromClosedWonQuote`'s own failure messages.

**Suggested notification channels for the alert-worthy tier itself**: reuse the exact channels this app already has wired (email/Slack/Teams/push via `triggerNotification`) rather than inventing a new delivery path — with an explicit fallback rule: a System Health alert about "notifications are failing" must not depend solely on the notification system that's currently failing (at minimum, also always visible on the System Health screen itself on next admin login, independent of whether any external channel delivered).

Not built. This is a design for E's review, to be scoped and implemented as its own, separately-reviewed piece of work.

**Recommended starting point unchanged**: this audit's own §14/§15 (ranked findings + a near-implementation-ready System Health data model, reusing `criticalLoadErrors`/`notification_deliveries`/cron logs rather than proposing new instrumentation) remains the right base to build from — the addendum above extends it, not replaces it.

### A2.4 System Health — refinement (task 8, 2026-09-11 overnight autonomous pass)

Extends §15 and A2.3 with the specific gaps this pass was asked to close: deduplication/recurrence counting as an actual algorithm (not just a column name), the Active/Acknowledged/Resolved lifecycle spelled out with real transition rules, a retention period, explicit retry eligibility per failure type, alert-loop protection, how the system reports failure of its own alerting path, and workspace awareness for a future second tenant. Still a design — nothing below is built, no schema/migration/UI created.

**1. Deduplication and recurrence counting — the actual matching rule.** Two failures are "the same recurring event" (increment an existing row's occurrence count) rather than "a new, separate event" (create a new row) when they share an **identity key**: `(surface, entity_type, entity_id | null, failure_reason_code)` — e.g. `("notification_delivery", "slack_channel_message", "channel-42", "webhook_404")`. This is deliberately narrower than "same surface" alone (§15's original table didn't specify this) — two different Slack webhooks failing for two different reasons are two different rows, not one row with a misleadingly high count, but the *same* webhook failing the *same* way three times in a row is one row with `occurrence_count = 3`. A failure with no natural entity id (a whole cron run failing) uses `entity_id = null` and keys on `(surface, failure_reason_code)` alone — e.g. every `task-overdue` cron throw is one recurring row, not one row per run. Each new match updates `most_recent_at` and increments `occurrence_count`; it never creates a duplicate row for an identity key that already has an open (Active or Acknowledged) row. A previously-**Resolved** row that matches again is **not** reopened silently — see item 2's Recovering-vs-new-incident rule below, which is exactly this same question stated from the lifecycle side.

**2. Lifecycle states, with real transition rules — not just three labels.**
   - **Active**: the default state the moment an alert-worthy failure (§A2.3's "what should create an alert" list) is first recorded, or a Resolved row's identity key fails again (see below). Requires attention.
   - **Acknowledged**: an admin has seen it and is aware, but the underlying cause isn't fixed yet ("Retry now" was tried and failed again, or a fix is in progress elsewhere). Acknowledging does **not** stop new occurrences of the *same* identity key from bumping `occurrence_count`/`most_recent_at` on the same row — it only stops it from re-alerting on every single occurrence (see item 5, alert-loop protection). An Acknowledged row does not silently expire back to Active on its own; only a new occurrence or an explicit admin action moves it.
   - **Resolved**: the admin marks it fixed (manually), OR the system auto-resolves it after a defined "recovery" signal specific to the surface (e.g. `notification_delivery` for the same identity key succeeds once; a cron run for the same job completes without throwing). Auto-resolution is a quiet, logged transition, matching §15.2's existing "Recovery is a quiet logged event, not a push alert" rule — it does not need its own alert.
   - **Reopening a Resolved row**: if the *same identity key* fails again after being marked Resolved, this is **not** silently folded back into the old row's history as if it never resolved — a genuinely new occurrence after a real recovery is worth re-alerting on its own (this is a fresh incident, potentially with a different root cause, even if it looks superficially identical). The system creates a **new** row for the same identity key, and the UI links it to the prior Resolved row as "previous occurrence: resolved <date>" for context, rather than either (a) silently reopening the old row and losing the fact it once recovered, or (b) treating it as entirely unrelated with no link at all.

**3. Retention period — DECIDED (2026-09-11, E), corrected from the original recommendation.** Resolved rows keep their full detailed record (technical reference, per-occurrence history, safe action taken) for **90 days** after `resolved_at`, matching this section's original recommendation. **After 90 days, a detailed row is not deleted — it is rolled up into a summarized count** (e.g. "Slack delivery failures: 14 occurrences, Jan-Mar 2026" per identity-key-and-month, or a similarly coarse bucket) and retained indefinitely at that summary level, with the detailed row then eligible for deletion. This still answers "has this happened before" during a later incident review (a real, recurring need this session's own multi-day audit trail has repeatedly relied on) without keeping an unbounded table of full-detail rows forever. Active/Acknowledged rows are never auto-deleted or summarized regardless of age — an old *unresolved* row aging out silently would be worse than the original visibility gap this whole feature exists to close. The 90-day detailed-retention window itself is unchanged from the original recommendation; what's newly decided is that expiry becomes a downgrade to a summary, not outright deletion.

**4. Retry eligibility — explicit per failure type, not a blanket "Retry now" button.** §A2.3 already proposed a "Retry now" action; this pass adds the missing rule for *when it's safe to show it at all*: a failure is retry-eligible only if re-attempting it is naturally idempotent or safely re-triggerable without risk of a duplicate side effect — e.g. a single notification-channel send (safe: sending it again either succeeds or fails again, no double-charge/double-write risk) or a cron job re-run (safe, by the job's own existing design). A failure inside a multi-step write with no transaction (e.g. a `restoreFullBackupSnapshot` step that already partially wrote something before failing, per §A2.2c) is **not** blindly retry-eligible from the System Health screen — offering "Retry now" there without knowing what already committed could create duplicates or mask a partial state. For anything in that category, the safe action is "Acknowledge" plus a link to wherever that feature's own recovery flow lives (e.g. the backup-restore screen's own resume/re-upload path, once §A2.2c's design exists), not a generic retry button that doesn't understand the underlying operation's own safety rules.

**5. Alert-loop protection.** Two distinct loop risks, both closed by the same underlying rule: **an Acknowledged or already-alerted-on Active row does not re-fire a new alert for every subsequent occurrence** — only the transition *into* Active (a brand-new identity key, or a reopened one per item 2) sends a new alert; `occurrence_count` incrementing on an already-alerted row updates the visible count but does not resend the notification. This directly prevents the second risk too: if the alert-delivery channel itself is degraded (e.g. Slack is down) and every attempt to *notify about* a failure itself fails, that failure-to-alert must not recursively create its own new System Health "alert delivery failed" event that then also tries to alert and also fails — the fallback in item 6 below (always-visible on next login, independent of any channel) exists precisely so a broken alert channel degrades to "silent until next login," not to "an infinite retry loop of alert-about-the-alert."

**6. Reporting failure of the notification system itself.** §A2.3 already stated the core rule ("a System Health alert about 'notifications are failing' must not depend solely on the notification system that's currently failing"); this pass makes the concrete mechanism explicit: every health event, regardless of whether any external channel successfully delivered a notification about it, is unconditionally visible on the System Health screen itself the next time any admin loads it — the screen's own data read (a direct table query) is the fallback delivery path that has no external dependency to fail. A specific case worth naming: if `notification_deliveries` writes themselves start failing (the very mechanism System Health partly reads from), that failure is itself a `(surface="notification_delivery_logging", ...)` health event recorded through a path that does **not** depend on `notification_deliveries` being writable — i.e. the health-event table must be a genuinely separate write path from the data it monitors, not layered on top of it, or a failure in the monitored system silently takes down its own monitoring.

**7. Workspace awareness for future tenants.** Every health event row carries a `workspace_id` (nullable today, matching the same temporary posture `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §5 and `PRODUCT_EQUIPMENT_RECIPE_ATOMIC_SAVE_PLAN.md` §8 already use for their own tables — one active workspace today, guarded by `active_workspace_id()`, with a real per-row workspace check deferred until Phase 3). This matters specifically because some failure surfaces are legitimately workspace-scoped (a specific project's notification failing) while others are not (a cron job failure, a Redis connection failure — these are infrastructure-wide, not per-tenant). The design should not force every row into a workspace scope it doesn't have: `workspace_id` is null for infrastructure-wide events and set for tenant-scoped ones, and the Admin > System Health screen (§15.3) filters by the caller's resolved workspace for scoped rows while always showing infrastructure-wide rows to every workspace's admins — a decision this pass is flagging as needed before a second workspace exists, not one it's making unilaterally now (matching the standing instruction not to begin Phase 3 RLS work).

**Example rows — fictional data, illustrating the full row shape above (not real events, not written anywhere):**

| Event | Surface | First seen | Most recent | Occurrences | Status | Safe action |
|---|---|---|---|---|---|---|
| "Inventory quantities failed to save" | `inventory_balances` write | 2026-09-11 02:14 | 2026-09-11 02:14 | 1 | Active | Acknowledge (multi-step write, not blindly retry-eligible — see item 4) |
| "Overdue-task scan failed" | `task-overdue` cron | 2026-09-11 06:00 | 2026-09-11 06:00 | 1 | Resolved (2026-09-11 06:05, next run completed clean) | — (auto-resolved, quiet) |
| "Slack delivery failed three times" | `notification_delivery`, channel `#warehouse-alerts` | 2026-09-10 14:02 | 2026-09-11 09:47 | 3 | Acknowledged | Retry now (single-channel send, retry-eligible) |
| "Backup restore stopped after Project Documents" | `restore`, snapshot `2026-09-11-0300` | 2026-09-11 03:11 | 2026-09-11 03:11 | 1 | Active | Acknowledge + link to the restore screen's own resume flow (§A2.2c) — not a generic retry |

Not built. UI, schema, migration, and alert wiring are all still separate, future, explicitly-reviewed work — this section only refines the specification.

## Addendum 3 (2026-09-12, overnight reliability closeout)

System Health itself has since been fully consolidated into its own implementation-ready document: **`PRODUCT_SYSTEM_HEALTH_PLAN.md`** — it supersedes this file's §15/A2.3/A2.4 as the place to look for the current, buildable design (nothing in this file's own System Health sections was wrong, they're just no longer the single source; the new doc adds the one remaining open item, §9 there: which alert channel/recipient fires a `down` transition).

### A2.5 — Backup restore reliability: fresh trace confirms and tightens A2.2c

A fresh, current-code trace of `restoreFullBackupSnapshot` and everything it calls (not relying on this document's own possibly-stale line citations) confirms A2.2c's conclusions and adds detail:

- **Call order** (`persistence.ts`, current): `saveInventoryItems` → `saveDeviceRecipes` → `saveProjectSites` → `saveRestoredPurchaseRequests` → `saveRestoredProjectDocuments` → `saveMovementsBuildsAllocations` (itself `saveBuildTransactions` → `saveInventoryMovements` → `saveProjectAllocations`). **No internal try/catch anywhere** — every call is a bare `await`; a throw from any step aborts every later step, including later steps inside `saveMovementsBuildsAllocations` itself. Confirmed unchanged from A2.2c's own trace.
- **Referential ordering is correct**, confirmed against the actual FK-resolution lookups in the current code (inventory items/recipes before projects' BOM lines resolve against them; builds before movements resolve `build_transaction_id`; movements before allocations resolve `movement_id`) — no ordering bug found.
- **Whole-backup atomicity — confirmed impractical**, and now precisely why: each of the six entry points issues its own independent PostgREST HTTP request(s); PostgREST commits each request as its own transaction, with no client-side mechanism spanning multiple REST calls. The only way to make the ENTIRE restore one transaction would be one giant orchestrating RPC accepting the whole snapshot as a single `jsonb` parameter and re-implementing every one of the ~15+ individual writes (all their current SKU/name/id resolution and validation) as PL/pgSQL inside it — a large, high-risk rewrite, genuinely disproportionate to what checkpointed restore actually needs. The proportionate design (below) keeps the six sections separate but makes the ONE genuinely non-atomic hot spot within them (BOM lines) safe, and tracks per-section state around the rest.
- **Idempotent retry — one of the two known gaps is now CLOSED, one remains open:**
  - `project_bom_lines` minting a brand-new id on every retry (previously true for `saveProjectSites`' delete-then-reinsert) is **closed once migration 131 (`replace_project_bom_lines`, drafted this same pass, not yet applied) is run** — reconcile-by-id means a retained line keeps its real id across repeated saves, including a restore retry.
  - `saveRestoredProjectDocuments`'s `document_number` regenerating from `Date.now()` on every call is **still open** — a retried restore of the same snapshot produces a different document number each time. This is a real, standalone gap (not touched by this pass) worth a small follow-up: derive `document_number` from the snapshot's own data (e.g. a value already present in the exported row) rather than the restore attempt's wall-clock time, so a retry is byte-for-byte idempotent. Small, isolated, no schema change — a good candidate for a future same-session fix, not attempted tonight (out of this pass's scope, which was tracing and planning, not fixing this specific function).
  - Every other write in the chain (`saveInventoryItems`, `saveDeviceRecipes` via its RPC, `saveRestoredPurchaseRequests`, `saveBuildTransactions`/`saveInventoryMovements`/`saveProjectAllocations`) is a keyed upsert — a full retry does not duplicate rows anywhere else.
- **No restore-run tracking exists at all today** — confirmed by searching every migration: no `restore_runs`/`backup_runs` table, no run id, no started/completed/failed status, nothing persisted or returned by `restoreFullBackupSnapshot` (`Promise<void>`) beyond a transient UI string. This confirms the checkpoint/resume design in A2.2c (run id, per-section `RestoreStepResult`/`RestoreOutcome`, a `snapshotId`-keyed resume token, dry-run validation, a final reconciliation report) remains **entirely greenfield, design-only** — nothing about it has been implemented, and nothing in this fresh trace changes that design's shape, only confirms its premises are still accurate against current code.
- **What must never be tested against real production data** (carried forward from A2.2c, restated for this pass since it governs any future implementation work here): every test for restore/checkpoint behavior must run against synthetic, clearly-named fixtures inside a rolled-back transaction (the same `ZZ_TEST_...` + `begin;/rollback;` convention every migration test script in this repo already uses) or a genuinely separate staging project — never a real restore attempt against production, and never destructive backup/restore testing of any kind outside that sandbox. This overnight pass did not run, or come close to running, any restore test against production — confirmed no SQL was executed anywhere in this pass.
- **Small, self-contained, non-workflow-changing follow-up candidates** (not implemented this pass — logging/verification only would be safe per this session's own commit rules, but none was judged urgent enough to bundle into tonight's isolated-fix set): giving `restoreFullBackupSnapshot` a real return shape (counts restored/skipped per section) instead of `Promise<void>` is themselves a small, additive, backward-compatible type change that doesn't require the full checkpoint design — flagged as the smallest real step toward A2.2c's recommendation #2, worth doing before the rest of that design if someone wants an incremental start.

### A2.6 — Optional-association warning: implementation scoping (traced, not implemented)

Fresh trace of every equipment/project/build NAME → id resolution site that currently saves an unresolved association as `null`, per the standing decision ("show a warning and require correction, rather than quietly saving the link as null" — decided 2026-09-11, still not implemented):

1. **`saveBuildTransactions`** (`persistence.ts`) — `equipment_type_id`/`finished_inventory_item_id` resolve via a name lookup keyed on `equipment_types.equipment_name`, but the build's own `equipmentName` field is populated from the recipe's `outputName`, not its `name`. These two fields start equal at recipe creation but can diverge the moment a user edits the "Equipment title" field (bound to `outputName`) without renaming the recipe's own internal `name`. **This is a real, standalone, already-confirmed defect independent of the optional-association policy question** — a key mismatch, not a genuinely-unresolvable name. Flagged here as a new confirmed defect (not fixed this pass): every future build of an equipment type whose title was ever edited silently gets both FKs written null. Fixing the key mismatch itself (matching both fields, the same way several read-side lookups in `main.tsx` already defensively check `outputName === build.equipmentName || name === build.equipmentName`) is close to a pure bug fix rather than a policy question — but what to do about *already-existing* `build_transactions` rows that are null for this reason today (backfill vs. leave alone) is a real, separate decision this pass does not make.
2. **`saveInventoryMovements`** — `project_id`/`build_transaction_id` resolve via name/number lookups; an unmatched name still safely resolves to `null` (the sibling `sku` resolution in this same function was already hardened in an earlier pass to hard-reject; project/build were explicitly left alone at that time).
3. **`saveProjectAllocations`** — same pattern for `project_id`/`inventory_item_id`/`movement_id`.
4. **`handleSendBomToPurchasing`** (`main.tsx`) — not a null-write site, but the closest existing "warn, don't silently drop" precedent already in production: an unmatched BOM line is counted and surfaced via the existing status banner ("... N skipped (no matching inventory SKU)."). This is the UX pattern to reuse, not invent.

**Scoping conclusion, matching the independent research done for this pass**: implementing the warning at the **persistence-layer** (rejecting an unresolved name inside `saveBuildTransactions`/`saveInventoryMovements`/`saveProjectAllocations` directly) is **not safe to do tonight** and stays a reviewed, not-yet-decided design, because:
- All three functions are shared, unmodified, between the live save path and `restoreFullBackupSnapshot` — there is no separate, more-lenient restore code path. A hard reject added here would make importing/restoring an old backup that happens to contain a genuinely-unresolvable historical name **fail the whole restore**, where today it degrades gracefully. Whether restore should be allowed to stay more lenient than live save is a real product decision, not something to default silently.
- All three functions upsert their **entire input array in one request**, and the live debounce-save effect re-fires on every state change with the same accumulated arrays — one single bad/legacy record with an unresolved project or build name would block *every* movement/build/allocation in the app from saving, repeatedly, not just the record just entered. A hard reject at this layer risks a real UX regression unless scoped carefully (e.g. reject only the offending record, not the whole batch — a design change beyond "add a warning").

**What IS safe and isolated, and remains available as a same-session follow-up (not done tonight, since it's still a UI/workflow addition, not a bug fix or logging change)**: a **form-level** check at the point of user entry/selection in `main.tsx` — before a movement/build/allocation object is ever created, confirm the chosen project/equipment/build value still matches something in the currently-loaded catalog (catches a stale dropdown or a mid-session rename/delete), using the existing `setActionStatus` "N skipped" banner pattern. This touches no persistence.ts function, no schema, and — critically — cannot affect restore, since restored data never flows through those interactive creation functions. Recommended as the actual first implementation step whenever this decision is picked up, ahead of any persistence-layer change.

### A2.7 — Task 5 fixes shipped this pass

Deployed (commit `dbf1a6c`, see `HANDOFF.md`): `.ok` checks and diagnostic logging added to `createPurchaseOrder` (also stopped fabricating fake "saved" line items on a real write failure — see that function's own comment), `addTaskHardwareDependency`, `updateTaskHardwareDependencyStatus` (logging-only, stays non-throwing — its caller is fire-and-forget), `createPurchaseOrderReceipt`, `getOrCreateVendorId`, `updatePurchaseOrderLineReceivedQty`, `createPurchaseRequestRemote`, `updatePurchaseRequestRemote`, `updateProjectLedgerInfo` (logging-only, stays non-throwing — its caller-side revert redesign was reverted 2026-09-11 and is not reattempted), and `saveProjectSites`' `projects` upsert (row-count check added for consistency, not a confirmed partial-write bug).

**Resolved 2026-09-12:** `PurchaseOrderDetailPanel.logLine` now branches on `updatePurchaseOrderLineReceivedQty`'s returned boolean and shows a plain, accessible success/failure message. The same review found and fixed a related false-success defect in `handleReceiveAllPurchaseOrderLines`: it previously skipped a failed line update but then marked every line and the entire order received. It now stops on the first failed write, updates local state only for lines actually saved, leaves the order open, and tells the user that the remaining lines were not changed.

## Addendum 4 (2026-09-12, overnight reliability closeout, part 2) — supersedes several "not fixed this pass" statements above

**Read this before treating any "not fixed this pass," "not attempted," or "remains open" statement
in A2.5, A2.6, or A2.7 above as still current.** A second work queue on the same overnight run
(commit `6e1a877`) closed several of the specific gaps those sections named as open. Nothing below
contradicts the trace/scoping work in A2.5/A2.6 — it implements what they had already correctly
scoped as safe next steps. `PRODUCT_MASTER_COMPLETION_PLAN.md` §2/§6 is the authoritative,
up-to-date status table across the whole plan; this addendum is the audit-specific detail behind
those rows.

- **A2.5's "small, self-contained, non-workflow-changing follow-up candidate"** — giving
  `restoreFullBackupSnapshot` a real return shape instead of `Promise<void>` — **is now DONE.**
  The function returns a `RestoreOutcome` (`{ ok, sections: RestoreSectionResult[] }`) with one
  entry per section (`attempted`, `succeeded`, `count`, `error`), computed by a new
  `runSection(section, count, run)` helper so one section's failure never blocks an unrelated
  later section. 7 new tests in `src/restore-backup-snapshot.test.ts` lock in: complete success
  with accurate per-section counts, first-section failure not blocking later independent
  sections, a middle failure preserving an earlier section's already-committed success, two
  malformed-snapshot rejection cases (via a new `validateBackupSnapshotShape`), and deterministic
  document-number retry (see next item). **What this does NOT do** (unchanged from A2.5's own
  conclusion): it does not make the whole restore atomic, and it does not add run-id/resume
  tracking — that remains the greenfield `restore_runs` design in A2.2c/A2.5, still not started.
- **A2.5's other open gap — `saveRestoredProjectDocuments`'s `document_number` regenerating from
  `Date.now()` on every retry — is now DONE.** `ProjectDocument`/`ProjectDocumentRow` gained a
  `documentNumber`/`document_number` field, populated and persisted on first save; a retry of the
  same snapshot now sends the same `document_number` both times. A legacy document with no
  recorded `documentNumber` still falls back to a generated `DOC-RESTORE-...` value (never
  duplicated across two exports of two different documents, but not itself idempotent across
  retries — a narrower, acceptable residual gap for pre-existing legacy rows only, not a new one).
- **A2.6's persistence-layer optional-association rejection is now DONE for all three named
  functions** — `saveBuildTransactions`, `saveInventoryMovements`, `saveProjectAllocations` all
  now reject a batch containing an unresolved equipment/project/build/movement reference, naming
  the offending record, rather than silently writing `null`. 17 new tests in
  `src/optional-association-warnings.test.ts`. This resolves A2.6's own scoping conclusion in the
  direction it recommended reviewing — **the restore-leniency question A2.6 itself raised remains
  genuinely open**: these three functions are still shared, unmodified, between the live save path
  and `restoreFullBackupSnapshot`, so a batch-level rejection here now also applies during
  restore. This was a deliberate, reviewed choice for this pass (matching the standing decision
  that an unresolved reference must warn and require correction, "never silently saved as null,"
  with no carved-out exception stated for restore) — but E should confirm this is the intended
  restore behavior, since A2.6 had flagged it as worth a separate leniency decision before this
  was implemented. The form-level UI guard A2.6 also scoped (a stale-dropdown check before object
  creation, independent of restore) remains **not implemented**, still a real, separate follow-up.
- **A2.6 item 1's confirmed defect is now FIXED**: `saveBuildTransactions`'s equipment lookup now
  resolves by `equipment_types.output_item.item_name` in addition to `equipment_name`, closing the
  key-mismatch that silently nulled `equipment_type_id`/`finished_inventory_item_id` whenever a
  recipe's "Equipment title" (bound to `outputName`) was edited without renaming the recipe's
  internal `name`. **Whether to backfill already-affected historical `build_transactions` rows
  remains an open, separate decision** — this pass fixes the bug going forward only, exactly as
  A2.6 itself anticipated ("what to do about already-existing rows... is a real, separate decision
  this pass does not make").
- **A2.7's remaining purchase-order receiving caller-UX gap is RESOLVED (2026-09-12).**
  Both single-line and receive-all actions now surface failure, and receive-all cannot falsely mark
  failed or unattempted lines as received. See `PRODUCT_MASTER_COMPLETION_PLAN.md` §2/§4 batch 4.
- **System Health**: Phase A (existing-data-only: `loadNotificationDeliveryFailures`, admin-gated
  UI) is now DONE — see `PRODUCT_SYSTEM_HEALTH_PLAN.md` and `PRODUCT_MASTER_COMPLETION_PLAN.md`
  for the current, authoritative status. Phase B (durable event storage beyond
  `notification_deliveries`) remains design-only, unchanged.
- Nothing in this addendum touches the Project BOM migration 131 package — it remains exactly as
  described in `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §7 and `HANDOFF.md`: drafted, tested
  locally, kept uncommitted, not applied to any database.

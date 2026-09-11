# Ergon Ops — Error-Handling & Failure-Visibility Audit

Priority 5 of the 2026-09-08 overnight work queue. Read-only audit — no files were modified to
produce this report. Scope: `src/persistence.ts` (10,700 lines), `src/main.tsx` (25,116 lines),
`api/*.js`, `api/_lib/*.js`, `api/cron/*.js`, `vercel.json`. All citations are file:line
references verified against the current source at audit time.

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
  `saveMovementsBuildsAllocations` — **none check whether their POST/PATCH actually wrote
  anything.** A partial or fully-blocked restore returns success with zero indication. The one
  finding in this audit that could plausibly turn a real incident into a *worse* one.
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

### A2.2 `restoreFullBackupSnapshot` — implementation plan (read-only audit; nothing implemented or run)

Full read-only trace of `persistence.ts:7336-7370` and everything it calls. This is the disaster-recovery path — the safety net for every other finding in this document — so its own reliability matters more than any individual feature it restores.

**What it does today, table by table:**

| Sub-call | Tables/Storage touched | Checked? |
|---|---|---|
| `saveInventoryItems` | `inventory_items` (upsert), `inventory_balances` (upsert) | Items: yes, with row-count validation. Balances: **✅ fixed, commit `4ea2fd1` (2026-09-10)** — `.ok` + exact row-count (`!==`) check, migration-091 fallback removed. |
| `saveDeviceRecipes` | `inventory_items` (read-only lookup), `equipment_types` (update or insert), `equipment_bom_components` (upsert + delete, fully traced this pass) | **⚠️ improved locally, NOT deployed, NOT atomic (2026-09-11)** — every step now checks `.ok` and, where PostgREST reports one, exact row count, plus two preflight input checks (see the finding above). Still no transaction of any kind; an earlier recipe/an earlier step within one recipe can already be committed when a later one fails. |
| `saveProjectSites` | `projects` (upsert), `project_scope_of_work` (upsert), `project_bom_lines` (delete + reinsert), `inventory_items` (read-only lookup) | Projects: yes, with row-count-implied validation via `idByName`. Scope of work: **✅ fixed, commit `4ea2fd1` (2026-09-10)** — `.ok` + exact row-count (`!==`) check. BOM lines: **still open, deliberately not touched** — a row-count check can't undo the DELETE that already ran; see `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` for the reviewed, unimplemented design. |
| `saveRestoredPurchaseRequests` | `purchase_requests` (upsert) | **No — the fetch's result isn't even assigned to a variable.** |
| `saveRestoredProjectDocuments` | `project_documents` (upsert, with a 400-retry fallback) | Neither the original attempt nor the retry's result is checked. |
| `saveMovementsBuildsAllocations` | `build_transactions`, `inventory_movements`, `project_inventory_allocations` (not traced this pass) | Not verified this pass — flagged as an inferred risk, not a confirmed finding, given the consistent pattern in every sibling function actually read. |

No Storage (file) operations are involved — this snapshot is purely relational data; document/photo files referenced by restored rows are not re-uploaded, only their existing `file_url`/`storage_path` references are restored (worth confirming those files still exist in Storage separately — out of scope for this pass).

**Which responses are currently unchecked**: every row in the table above marked "no" — concretely, the per-recipe `equipment_types` update, `purchase_requests`, and `project_documents` (both attempts), plus `project_bom_lines`' delete-then-reinsert (still no transaction, see above). `inventory_balances` and `project_scope_of_work` were fixed 2026-09-10 (commit `4ea2fd1`) and are no longer part of this list. This is the same failure class as the now-fixed `createProjectFromClosedWonQuote`, just spread across the remaining functions.

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
4. **`saveRestoredPurchaseRequests` and `saveRestoredProjectDocuments`'s own POST calls remain entirely unchecked** (bare `await fetch`, no `.ok` check, confirmed by direct read) — neither this pass nor the `4ea2fd1` pass touched them. A retry's own success is therefore not even verifiable yet for these two steps, separate from the identity/timestamp concerns above.
5. **Timestamps and other generated values** (`uploaded_at` defaulting to `new Date().toISOString()` when a snapshot doesn't carry one, `created_at` passthrough vs. generated, and any other server-assigned value not carried verbatim in the snapshot) can differ between attempts for the same underlying record.

**Revised conclusion**: a full retry (re-running the whole restore against the same uploaded snapshot) is a **promising recovery direction for the top-level natural-key records that are cleanly keyed** (`inventory_items` by `sku`, `equipment_types` by `equipment_name`, `projects` by `project_name`) — those genuinely look idempotent on direct inspection. It is **not proven end-to-end**, and specifically not proven for BOM line identities, dependent foreign keys, generated document numbers, or the two still-unchecked restore writes above. **Checkpoint/resume design stays open, not closed or rejected**, until a real end-to-end retry test exists that verifies: the restored *content* matches on a second attempt, row *identities* are stable or the instability is deliberately accepted and documented, dependent foreign keys (`task_hardware_dependencies` and any other future FK into a restored/regenerated table) survive or are correctly re-pointed, and no duplicate rows accumulate from running the restore twice. None of that test exists yet — this document does not claim it does.

This remains a plan only — no code for this was written or run, per the explicit instruction to audit and design, not implement or run a restore.

### A2.2a Targeted unchecked-write scan — ranked findings (task 9, 2026-09-11 overnight local-only pass)

Fresh, direct re-read of every function named in this document's own §5 list (the original "fetch calls that never inspect `response.ok`" catalogue), current line numbers confirmed against today's source, excluding everything already resolved above (`saveInventoryItems` — both writes; `saveProjectSites` — projects/scope-of-work; `saveDeviceRecipes`; `recordNotificationDelivery`; `addTaskActivity`) and `createProjectFromClosedWonQuote` (superseded entirely by migrations 127/128).

**Attempted, then reverted after review (2026-09-11, same day)**: `updateProjectLedgerInfo`, `updateInstalledAsset`, and `updateProjectStakeholder` were given the same `.ok` + row-count fix as everything else in this section, with their `main.tsx` callers (`handleUpdateProjectLedgerInfo`/`handleUpdateInstalledAsset`/`handleUpdateProjectStakeholder`) changed to capture the prior array state and restore it on a caught failure. **This was reverted, not shipped.** The revert-on-failure design was unsound: capturing "the array as it was" inside a React state-updater callback and restoring that exact array later is not a safe concurrency primitive — if a second edit lands while the first request is still in flight, an older failed request's revert can overwrite the second edit's already-applied change with stale data, silently erasing real work rather than protecting it. This needed a deliberate concurrency-safe design (e.g. reverting only the specific field that failed, not the whole array, or a per-id in-flight guard), not a same-night mechanical fix. Separately, code tracing found two of the three writers are not actually live today: `handleUpdateInstalledAsset` has **no call site anywhere in `main.tsx`** (confirmed by grep — only its own definition matches), and `onUpdateProjectStakeholder` is passed as a prop into `<Projects>` but is not actually invoked by anything inside that component or its children. `updateProjectLedgerInfo`'s caller does appear to be live-wired. All three functions are confirmed to still have the original unchecked-write gap described below — this correction is about the fix's own safety and the caller-liveness claim, not about the underlying finding being wrong.

**Confirmed, documented, NOT fixed** (real gaps, ranked — left for a future pass given the volume; every one below is the same class of fix, just not yet done):

| Function | Line | Severity | Real-world example | Note |
|---|---|---|---|---|
| `updateProjectLedgerInfo` | `persistence.ts:7112` | **Medium-High** | A PM sets a project's warranty-expiration date; an RLS hiccup drops the write; the date shown looks "saved" but the Client Ledger's EOL tracking is quietly wrong until someone notices during an actual warranty claim. | **Attempted and reverted 2026-09-11** — see note below the table. Caller (`handleUpdateProjectLedgerInfo`) appears live-wired. |
| `updateInstalledAsset` | `persistence.ts:7233` | **Medium-High** | Editing a serial number's install date after a data-entry correction silently doesn't take, and the wrong EOL date keeps being used for that physical unit. | **Attempted and reverted 2026-09-11.** `handleUpdateInstalledAsset` has **no call site anywhere in `main.tsx` today** — confirmed dead code, not just an unverified write. |
| `updateProjectStakeholder` | `persistence.ts:7368` | **Medium-High** | A property owner's phone number is corrected in Stakeholders; the edit silently fails, and the next person who calls that number reaches the old contact. | **Attempted and reverted 2026-09-11.** `onUpdateProjectStakeholder` is passed into `<Projects>` but not actually called anywhere downstream — confirmed dead wiring, not just an unverified write. |
| `updateSalesQuoteInfo` | `persistence.ts:11012` | **High** | Editing a Sales Quote's core header fields (client info, pricing-adjacent fields) silently doesn't persist; the quote looks updated in the UI until a reload shows the stale version — potentially after it's already been sent to a customer. | |
| `updateTaskHardwareDependencyStatus` | `persistence.ts:4463` | **Medium-High** | A hardware dependency is marked `allocated`/`procurement_queued` for a task; a silent failure leaves warehouse/purchasing looking at a stale status, so the task appears blocked or ready when it isn't. | |
| `updateSalesQuoteLocation` / `updateSalesQuoteLocationItem` | `persistence.ts:9130` / `9223` | **Medium-High** | A Sales quote's site details or a location's hardware line silently fails to update; the quote presented to (or already sent to) a customer doesn't match what was actually entered. | |
| `updateProjectLocation` / `updateProjectLocationItem` | `persistence.ts:9709` / `9865` | **Medium-High** | Same shape, post-conversion — a project location's install details silently don't save, and field crews work from stale information. | |
| `updateFormSchemaField` | `persistence.ts:4051` | **Medium** | An intake form field edit (label, required flag) silently doesn't persist — the next intake submission uses the old field definition with no one aware it reverted. | |
| `updateSiteHardwareRule` | `persistence.ts:4357` | **Medium** | A pre-sales hardware rule edit silently fails — future quotes keep using the old rule. | |
| `updateVendor` | `persistence.ts:8042` | **Medium** | A vendor's contact/terms edit silently fails — purchasing keeps seeing outdated vendor info. | |
| `updateSalesQuoteBomLineCatalogLink` / `deleteSalesQuoteBomLinesByLocationSource` | `persistence.ts:9077` / `9067` | **Medium** | A BOM line's catalog link silently fails to update/clear — cosmetic/bookkeeping drift in the quote's BOM, not the line's core content (item/qty), which are separately covered. | |
| `markNotificationRead` / `markAllNotificationsRead` | `persistence.ts:3326` / `3338` | **Low** | The notification bell's unread badge silently doesn't clear — reappears or stays stuck; annoying, self-corrects on the next real notification or reload. | |
| `removePushSubscription` | `persistence.ts:1840` | **Low** | Turning off push notifications on a device silently doesn't take — that device keeps getting pushes it opted out of, until retried. | |
| `addDirectMessageReaction` / `removeDirectMessageReaction` / `addChannelMessageReaction` / `removeChannelMessageReaction` | `persistence.ts:1173/1184/1664/1675` | **Low** | An emoji reaction silently doesn't add/remove — immediately visible and re-clickable, no data at risk. | |
| `ensureTeamMemberForSelf` | `persistence.ts:3193` | **Low** | A first-time admin sign-in silently fails to add them to the roster — self-heals on the next sign-in, already wrapped in its own try/catch. | |

**On the three "attempted and reverted" rows above**: the write-verification shape (`.ok` + `rows.length`, matching the already-correct sibling `deleteInstalledAsset`/`deleteProjectStakeholder`) is fine and can be reused directly. What's missing is a concurrency-safe caller-side design — capturing "the array as it was" inside a React state-updater callback and restoring that exact array on a later failure is not safe: if a second edit lands while the first request is still in flight, an older failed request's revert can silently overwrite the second edit's already-applied change with stale data. A real fix needs to revert only the specific field that failed (not the whole array) or use a per-id in-flight guard — a deliberate design, not a same-night mechanical fix. Also confirmed live: `handleUpdateInstalledAsset` has no call site anywhere in `main.tsx`, and `onUpdateProjectStakeholder` is wired into `<Projects>` as a prop but never actually invoked downstream — both are dead code today, not just unverified writes, so fixing the persistence-layer function alone would not make either one live.

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

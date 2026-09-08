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

# Ergon Ops — Accessibility, Mobile, Performance & Dependency Audit

Priority 8 (part 1) of the 2026-09-08 overnight work queue. Read-only — no files modified, no
`npm audit fix` run. Baseline: the existing mobile convention documented in `HANDOFF.md`
(`.table-scroll`, `.stack-table-mobile` + `data-label`, `.clickable-row`, icon-only `<Trash2/>`
buttons) is treated as "already fixed" — findings below are either **new** gaps or places where
that convention exists but wasn't actually applied.

---

## Part A — Accessibility (WCAG-oriented)

### A1. Modals have no focus trap, no focus return, and most have no Escape-to-close (High impact)

Every modal follows the same wrapper pattern: `<div className="modal-backdrop" role="presentation"><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="...">`.
**38** such `role="dialog"` instances exist, plus **8 more** (`main.tsx:12581,12624,12718,12789,12864,13383,13406,13570`,
the Product Catalog/Sales-BOM build flow) with **no `role="dialog"`, `aria-modal`, or
`aria-labelledby` at all**.

Across all 46, there is:
- **No focus trap** — Tab/Shift+Tab moves focus into the page behind the modal. Whole-file grep
  for `.focus()` returns only 2 hits (`main.tsx:14439,14456`), both unrelated (Messages compose
  textarea autofocus), not modal-entry or trap logic.
- **No focus-return-on-close.**
- **No Escape-to-close**, with one narrow exception — the only 4 `Escape` handlers in the file
  (`main.tsx:7058,14396,14559,14799`) are for the top-nav search dropdown, the image lightbox,
  thread search, and the @mention picker — none of the 46 dialog modals handle Escape.

Real WCAG 2.1.2 (No Keyboard Trap) / 2.4.3 (Focus Order) gap, not cosmetic — a keyboard-only user
can tab out of an open modal into the page behind it and has no keyboard-only way to dismiss it.
Reference example: `main.tsx:8870-8896` (Receive Purchase Request modal) — correctly labeled, but
no `onKeyDown` anywhere in the modal tree.

### A2. Desktop `<tr className="clickable-row">` rows are not keyboard-operable (High impact)

The row-as-click-target convention was correctly implemented for **mobile cards** (e.g.
`main.tsx:10563,12451` both have `role="button" tabIndex={0} onKeyDown={...}`). The **desktop
`<tr>` equivalent of the same rows does not.** 12 instances of `<tr className="clickable-row" onClick={...}>`
with no `role`, `tabIndex`, or `onKeyDown`: `main.tsx:8814` (Purchase Requests), `9177` (Purchase
Orders), `10507` (Inventory items), `12416` (Projects list), `13456` (Project BOM lines),
`13840`/`13870` (Client Ledger, both tabs), `17409` (Team Roster), `18915` (Catalog items),
`21715`/`22713` (Project & Sales Quote Locations), `24356` (Task list rows).

A `<tr>` is not natively focusable or actionable — a keyboard-only user cannot open any of these
rows' edit views at all on desktop. Directly contradicts the same standing rule that correctly
drove the mobile-card fix.

### A3. Form-submission errors are not announced to assistive tech (Medium-high impact)

Whole-file search for `role="alert"` and `aria-live` returns **zero matches**. Every inline form
error is a plain `<div>`/`<small>`: `main.tsx:23850` (Task Editor), `24774` (public Submittal
response form), `24921` (public Proposal response form). A screen reader user gets no notification
that a save failed. Sitewide gap, most consequential on the two **public, unauthenticated** pages
(A8) where there's no colleague to ask "did that work?"

### A4. Form labels: mostly correct via implicit wrapping; filter/search inputs are the exception

Spot-checked Sales Quote creation, Task Editor, Purchase Request/Create Purchase — all
consistently use `<label>Text<input/></label>` or `aria-label` on ambiguous grid inputs. Solid.
The gap: **list/table filter and search inputs have no label at all**, only a `placeholder`
(disappears on input, not a reliable accessible name): `main.tsx:7047-7056` (global top-nav
search), `14261` ("Search people to add..."), `18966` (Catalog search), `21289` (Site Builder
gallery search). Client Ledger's search (`main.tsx:13831`) is correctly wrapped — the fix pattern
already exists in the codebase, just not applied everywhere.

### A5. Color contrast — a family of "muted" text colors fails WCAG AA (Medium impact, computed)

No CSS custom properties for theme colors — hardcoded hex throughout `styles.css`. Computed
contrast against the actual page background (`#f4f1eb`/`#f2eee7`):

| Color | Used for | Ratio vs bg | WCAG AA (4.5:1 normal / 3:1 large) |
|---|---|---|---|
| `#756d62` | primary "muted" text (40+ uses) | ~4.53:1 | Passes normal text, barely |
| `#8a8272` | task audit meta, activity log | ~3.38:1 | Fails normal, passes large only |
| `#948c7f` | field hints, document-row meta | ~2.95:1 | Fails both |
| `#9a9184` | **widely used**: message timestamps, section subtitles, activity meta, avatar placeholders, channel labels (19+ call sites) | ~2.76:1 | Fails both |

`#9a9184` is not a rare edge case — it's the standard secondary/meta-text color for Messages and
several audit-trail surfaces, exactly the kind of low-emphasis-but-meaningful text WCAG cares
about. Low-vision users will struggle to read timestamps and hint text sitewide.

### A6. Icon-only buttons: aria-label coverage is good, with one inconsistency

Spot-checked all 27 `<Trash2/>` usages — the overwhelming majority correctly carry `aria-label`.
A handful rely on `title` alone (`main.tsx:21757-21765,22563-22571,22604-22609`). `title` does
fall back to an accessible name per the HTML accname algorithm, so not a hard failure — worth
normalizing to `aria-label` for consistency.

### A7. Mobile tap targets are undersized (Medium impact, confirmed in CSS)

`.icon-button` (base class for nearly every icon-only action sitewide) is **34×34px**
(`styles.css:3282-3294`), no mobile-specific enlargement — overrides found only bump specific
toolbars to 34-40px, not the general case. `.compact-remove` is 34×38px. Checkboxes are
explicitly pinned to **16×16px** or left at browser default, with no mobile min-size override
anywhere. Both fall short of the commonly-cited 44px(Apple)/48px(Material) guidance — the 16px
checkboxes, sometimes overlapping a photo thumbnail, are a real field-usability risk for a
mobile-first user tapping through BOM lines or gallery selections on a phone.

### A8. Public Proposal & Submittal pages — extra scrutiny (the one surface an external customer touches)

- **Convention exists but wasn't applied**: both pages' BOM tables use `className="stack-table-mobile"`
  (`main.tsx:24888,24759`) but **no `<td>` has a `data-label`** — the exact "orphaned header" bug
  HANDOFF already documents as fixed elsewhere ("default to adding `data-label` on every
  non-obvious cell"). On mobile the `<thead>` disappears and a bare "Qty" number (and, on the
  Proposal page, an empty-header thumbnail column) loses all column context.
- Same `submitError` visual-only announcement issue as A3, here reaching an external customer
  with no colleague to ask for help.
- Positives: labels correctly wrap the name/notes inputs, images have `alt` text, headings are
  structured, external links use `rel="noreferrer"`.

---

## Part B — Mobile workflow audit

The HANDOFF-documented rollout is genuinely thorough for **CSS overflow** — spot-checks confirm
it holds up; new gaps found here are outside what that rollout checked for (keyboard access,
`data-label` completeness on 2 specific tables).

- **Sign-in/onboarding** — fluid card, `width:100%; max-width:380px`, no fixed-width overflow risk. Clean.
- **Client Ledger** — both tables correctly use `stack-table-mobile` with full `data-label` coverage. Confirmed working.
- **Photos / offline upload queue** — confirmed genuinely sitewide, not just claimed. `CameraCaptureModal.saveAll()`
  is the shared queueing implementation, used identically for Project Locations, Sales Quote
  Locations, *and* Purchase Order paperwork — all three funnel through the same
  `queuePendingSitePhoto` fallback. Shipping's packing photos use a second, purpose-built
  implementation correctly wired into the Shipping panel. This specific HANDOFF claim checks out.
- **Proposal preview / public pages** — see A8; the `data-label` gap is as much a mobile-usability
  bug as an accessibility one.
- **Modal width on mobile** — fluid, backdrop padding adjusts under 760px, no overflow risk.
- Tasks, Purchasing/receiving, Project location entry, Messages — not independently re-audited for
  overflow beyond the above; HANDOFF's own detailed prior audit trail is trusted for what it
  explicitly claims to have checked, and no contradicting evidence was found in the areas sampled.

---

## Part C — Performance

### C1. Production bundle — confirmed and quantified

```
dist/assets/index-*.js        1,333.36 kB │ gzip: 357.01 kB   ← main app bundle, eager
dist/assets/pdf-*.js            476.81 kB │ gzip: 142.04 kB   ← lazy (dynamic import)
dist/assets/pdf.worker-*.mjs  2,206.30 kB                     ← lazy, worker, on demand only
dist/assets/index-*.css         107.57 kB │ gzip:  18.55 kB
```

The `>500kB chunk` warning is real: **1.33MB (357KB gzip) ships to every user on first load**,
before any route-based code-splitting. `pdfjs-dist` is correctly deferred via dynamic import and
only loads when a PDF feature is used — done right.

**Concrete, low-risk fix candidate**: `XLSX` (SheetJS) is imported eagerly at the top of the file
(`main.tsx:3`) but only referenced in two rarely-hit handlers — BOM import and Catalog import.
Converting both call sites to a dynamic `import("xlsx")` would code-split it out of the eager
bundle for the ~95% of sessions that never touch a bulk import, at essentially zero risk.

### C2. Zero memoization anywhere in the codebase (Medium-high architectural risk, confirmed)

`main.tsx` imports only `Component, Fragment, StrictMode, useEffect, useRef, useState` from React
— **`useMemo`, `useCallback`, and `React.memo` are never used**, anywhere in 25,116 lines. A
single top-level `App` component means every state update re-renders the entire tree, and every
derived value — including `globalSearchMatches`/`globalSearchMatchesFull`, which run 7 separate
`.filter()` passes over every major data array — recomputes on every render of `App`, not just
when its own inputs change. At Ergon's current data volumes this is unlikely to be visibly janky,
but it's a real structural risk as data volume and re-render frequency grow (e.g. the 5s
Messages-thread poll triggers a state update while any other view is mounted under the same
`App`). Worth targeted `useMemo` around the genuinely expensive derived arrays rather than a
sitewide rewrite.

### C3. Full-table loads with no `limit=` (Medium impact, matters within 1-2 years at Ergon's scale)

- `inventory_movements` — correctly bounded: `limit=2000`. *(Aside: also filters
  `legacy_id=not.is.null`, which reads like it could be silently narrowing "all movements" to
  "only migrated-legacy movements" — a correctness question worth a second look, not chased
  further here since it's outside performance scope.)*
- `purchase_requests` — **no `limit=` at all**, fetches the full table every load.
- `purchase_orders` — **no `limit=`** on any of its 4 fallback-tier queries, each pulling every PO
  with all nested line items, receipts, and files embedded.

Neither is a problem today, but neither has a soft-delete/date filter or cap, and both grow
strictly monotonically (POs and purchase requests aren't purged). The one Part C finding with
genuine multi-year real-world impact — should get a `limit=`/pagination pass before either table
reaches the thousands-of-rows range.

### C4. Polling — reasonable, not a concern at this scale

5 `setInterval` sites (offline-photo-flush every 45s, Messages overview every 20s, open thread
every 5s, known-users refresh every 90s, open channel every 5s) — all correctly scoped inside
`useEffect` with cleanup, gated on an actually-open session/thread. Negligible load for a
small-to-mid team; not flagged as a real risk.

### C5. Uploaded photos are not resized — full sensor resolution goes over the wire (Medium-high real-world impact)

- **In-app camera capture**: `canvas.width = video.videoWidth; canvas.height = video.videoHeight`
  — captures at the device's full native sensor resolution (often 3000-4000px on a modern phone),
  encoded as JPEG at quality 0.9. **No downscaling step anywhere.**
- **"Upload from device" / gallery picker**: the original `File` is used as-is, no processing.

Given the app's own field-use case (photos taken "in a parking garage," per its own code
comments, over possibly-poor connectivity), this is a real, concrete cost: multi-MB photos
uploaded one at a time from a phone on cellular, and the offline queue has to hold those same
full-size blobs in IndexedDB while waiting to retry. A client-side resize to ~1600-2000px wide
before upload would meaningfully cut upload time, mobile data usage, and Supabase Storage cost,
with no visible quality loss for documentation photos.

### C6. Global search scalability — confirmed pure client-side filter, no near-term fix needed

Plain `.filter(...).slice(0,5)` over already-loaded state, gated behind a 2-character minimum.
Fine as-is at Ergon's actual scale — doesn't need a backend search index. One dependency worth
flagging: capping C3's tables server-side would silently narrow what global search can find
unless search is updated in the same pass.

---

## Part D — `npm audit` (report only, no fixes applied)

```
5 vulnerabilities (1 moderate, 4 high)
```

| Package | Severity | Issue | Fix available? |
|---|---|---|---|
| `browserslist` (≤4.28.6) | High | Unbounded memory growth (no cache eviction) → OOM; uncaught crash/prototype write via untrusted `browserslist-stats.json` | Yes — `npm audit fix` |
| `nanoid` (<3.3.18) | High | Custom generators can loop indefinitely when size is zero | Yes — `npm audit fix` |
| `pdfjs-dist` (≥5.6.83 <6.2.108) | High | Arbitrary JavaScript execution upon opening a malicious PDF | Yes — `npm audit fix` |
| `postcss` (≤8.5.22) | Moderate | Incomplete fix of a prior advisory — attacker-controlled `sourceMappingURL` reads arbitrary `.map` files when `from` is unset | Yes — `npm audit fix` |
| `xlsx` (all versions) | High | Prototype Pollution in SheetJS; ReDoS | **No fix available** |

The one vulnerability with **no available fix** (`xlsx`) is the same library flagged in C1 as an
eager-bundle-size problem — a candidate for either a maintained replacement (e.g. `exceljs`) or,
at minimum, isolating it behind the dynamic-import change from C1 so the vulnerable parsing code
only ever loads for the two admin-triggered bulk-import flows. `pdfjs-dist`'s
malicious-PDF-execution risk is worth prioritizing given the app actively renders
user/vendor-supplied PDFs (sales quote extraction, purchase order attachments) — the highest-
severity item here to review, even though a mechanical `npm audit fix` is available. **No fixes
were applied**, per the read-only scope of this audit and the explicit instruction not to run
`npm audit fix` or automated upgrades.

---

## Part F — `xlsx` dependency deep-dive (task 7, overnight autonomous pass, 2026-09-11)

Read-only follow-up on the C1/Part D findings above, at the depth those sections didn't go into.
No package was installed, removed, or upgraded to produce this.

### Installed version and every import/call site

`package.json:28` — `"xlsx": "^0.18.5"`. Confirmed via `npm ls xlsx`: exactly `xlsx@0.18.5` is
resolved, no transitive duplicate. **Exactly one import site in the whole codebase**:
`src/main.tsx:3`, `import * as XLSX from "xlsx";` — a static, eager import (loads for every
session, not just the two flows that use it — this is the same fact C1 already flagged as a
bundle-size issue).

**Exactly two usage sites, both read-only, both the same shape**:
- `handleBomFileSelect` (`main.tsx:11832-11864`) — BOM spreadsheet import on the Project detail
  page.
- `handleCatalogFileSelect` (`main.tsx:18622` on) — bulk Product Catalog import.

Both call `XLSX.read(buffer, { type: "array" })` then `XLSX.utils.sheet_to_json(sheet, { defval:
"" })` on the **first sheet only**, then map loosely-matched column headers (case/whitespace-
insensitive `find()` over candidate header names) into typed rows. **No write/export path exists
anywhere** — this app never generates a `.xlsx` file with this library, only reads one a user
selects. That materially narrows the feature surface a replacement would need to cover.

### Whether workbook inputs are user-controlled

**Yes, entirely.** Both call sites are wired to a plain `<input type="file">` `onChange` handler;
`file.arrayBuffer()` is read directly from whatever the browser's file picker returned, with
**no server round-trip** (parsing happens entirely client-side, per the code's own comment at
`main.tsx:11828-11831`: "no upload endpoint, no server round-trip"). The parsed result is only
ever shown as a preview and requires an explicit "commit" action before anything is written to
app state — but the vulnerable *parsing* step itself (where a Prototype Pollution or ReDoS
payload would actually trigger) happens before that preview/commit gate, not after it, so the
preview step does not act as a safety check against either vulnerability.

### Existing file-size/type/row limits

**None found, on either call site.** No `file.size` check before calling `.arrayBuffer()`, no
file-extension/MIME-type allowlist beyond letting `XLSX.read()` throw (caught generically and
shown as "Could not parse that file. Make sure it's a valid .xlsx or .csv."), and no cap on the
number of rows `sheet_to_json` returns before mapping over all of them. A user could select an
arbitrarily large file and the browser tab would attempt to fully parse it.

### The exact known vulnerabilities and realistic exposure in this app

`npm audit`'s JSON output for `xlsx` (re-confirmed this pass, not just cited from Part D):

| Advisory | CVSS | Fixed in | CWE |
|---|---|---|---|
| Prototype Pollution in SheetJS (`GHSA-4r6h-8v6p-xvw6`) | 7.8 (`AV:L/AC:L/PR:N/UI:R`) | `>=0.19.3` | CWE-1321 |
| SheetJS ReDoS (`GHSA-5pgg-2g8v-p4x9`) | 7.5 (`AV:N/AC:L/PR:N/UI:N`) | `>=0.20.2` | CWE-1333 |

**Realistic exposure in this specific app, not the abstract CVSS scenario**: both vulnerabilities
require the vulnerable parsing code to actually run on attacker-controlled spreadsheet bytes.
Because both call sites require a real, logged-in Ergon user to deliberately pick a file via
their own OS file dialog — there is no passive/drive-by trigger, no server ever parses an
uploaded file, and no unauthenticated path reaches this code at all — the practical attack
requires **social engineering a legitimate internal user** (e.g. "here's the BOM spreadsheet for
this job" from a compromised or malicious vendor/subcontractor email, or a booby-trapped catalog
export) into importing a file they believe is legitimate. That is a real, credible vector for a
company that regularly receives spreadsheets from external parties (vendors, subcontractors) —
just not a remote, unauthenticated one. Impact if triggered: Prototype Pollution can corrupt
`Object.prototype` for the rest of that page's JavaScript execution (unpredictable app behavior,
potentially exploitable for further client-side attacks depending on what other code reads
polluted properties); ReDoS can hang or crash that user's browser tab while parsing, a
availability/annoyance impact scoped to that one tab, not the server or other users.

### Compensating controls possible without replacing the library

None of these fix the underlying parser vulnerabilities, but all reduce exposure and are safe to
build without touching the dependency itself:

1. **File-size cap before parsing** (e.g. reject anything over ~5-10MB with a clear message) —
   trivial, `file.size` is available before `.arrayBuffer()` is ever called.
2. **File-extension allowlist** (`.xlsx`/`.xls`/`.csv` only, reject anything else before handing
   bytes to `XLSX.read`) — narrows, doesn't eliminate, the input surface.
3. **Dynamic `import("xlsx")` instead of the eager static import** (already recommended in C1 for
   bundle-size reasons) — this has a genuine, if partial, security benefit too: the vulnerable
   parsing code would only ever load into memory for the ~2 flows that use it, not for every
   session on page load, slightly narrowing when the code is even present to be triggered.
4. **A row-count cap** on the parsed result (e.g. refuse/truncate past a few thousand rows) —
   reduces the ReDoS blast radius (less content for a pathological regex to run against) without
   fixing the root cause.
5. **User education**: since the realistic vector is a socially-engineered file from an external
   party, a one-line UI warning ("Only import files from a source you trust") costs nothing and
   matches the actual threat model better than a technical control would alone.

None of these are a substitute for a real fix — they're worth doing regardless of which option
below is chosen, since they cost little and reduce blast radius immediately.

### Credible maintained replacements

1. **Stay on SheetJS, but stop installing from the public npm registry.** Confirmed this pass via
   `npm view xlsx versions`: **the npm registry's own `xlsx` package tops out at `0.18.5` — there
   is no newer, patched version published to npm at all**, which is exactly why `npm audit`
   reports `"fixAvailable": false` (a normal `npm update`/version bump cannot fix this). SheetJS
   has continued fixing these CVEs in versions only distributed through their own CDN
   (`https://cdn.sheetjs.com/`), not the npm registry. **This would mean changing `package.json`'s
   `xlsx` entry from a registry version to a direct URL/tarball dependency** pointing at a current
   SheetJS CDN release — the API (`XLSX.read`, `XLSX.utils.sheet_to_json`) is unchanged, so this
   is close to a zero-code-change fix, but it does change *how* the dependency is installed
   (a URL dependency, not a semver range), which itself has tradeoffs (no automatic security
   advisories from GitHub/npm for a URL dependency, reliance on SheetJS's own CDN uptime during
   `npm install`, and it's a slightly unusual pattern for whoever maintains this repo next to
   understand at a glance).
2. **Migrate to `exceljs`** — a genuinely different, actively-maintained library on the standard
   npm registry, MIT licensed. Real migration effort: `exceljs`'s API is different from SheetJS's
   (`workbook.xlsx.load(buffer)` then iterating worksheet rows/cells, not `sheet_to_json`), so
   both call sites would need rewriting, not just a version bump — a small, contained change given
   there are only two call sites and both are read-only, but not zero-effort. `exceljs` is
   primarily designed for Node; using it in a browser bundle needs verification that its browser
   build doesn't pull in Node-only dependencies (`fs`, etc.) that would bloat or break the Vite
   build — worth a small spike before committing to this path, not assumed to just work.
3. **Do nothing beyond the compensating controls above.** Given the exposure requires a
   deliberate, socially-engineered user action and there is no server-side parsing at all, this is
   a defensible short-term position if E prefers not to spend migration effort right now — but it
   leaves a real, currently-unfixable-by-`npm audit fix` vulnerability in the dependency tree
   indefinitely.

### Migration effort, bundle impact, licensing, and test needs (comparing options 1 and 2)

| | Option 1: SheetJS CDN URL dependency | Option 2: migrate to `exceljs` |
|---|---|---|
| Code changes | None (same API) | Both call sites rewritten (different parsing API) |
| Bundle size | Unknown without checking — SheetJS's newer builds have historically been similar or smaller; would need to actually measure post-change, not assume | Unknown without checking — `exceljs`'s footprint for a browser bundle needs verification given its Node-first design |
| Licensing | Apache-2.0, unchanged from today | MIT — compatible, no new obligation |
| Install reliability | Depends on SheetJS's CDN being reachable at `npm install` time — a new external dependency in the install process that doesn't exist today | Normal npm registry install, no new risk |
| Test needs | Re-run both import flows against real sample files (BOM spreadsheet, catalog export) to confirm identical parsed output — low effort, existing manual test files likely still work | Same manual re-test, plus verify no Node-polyfill issues surface in the actual Vite production build, not just local dev |
| Ongoing maintenance | Tied to SheetJS continuing to publish CDN-distributed fixes indefinitely — same trust dependency as today, just via a different channel | Normal npm-registry maintenance, more conventional going forward |

### Recommendation — clearly marked for E's decision, not decided here

No option above is selected. Given only two read-only call sites exist and the exposure requires
a deliberate internal user action (not a passive/remote trigger), this is a real but not urgent
fix — worth scheduling deliberately rather than reacting to it as an emergency. If forced to rank:
**Option 1 (SheetJS CDN URL dependency) is the lowest-effort real fix** since it needs no code
changes to either call site, but it trades a conventional npm dependency for a URL-pinned one.
**Option 3 (compensating controls only, deferred replacement)** is the reasonable choice if E
would rather not touch the install mechanism at all right now. **This decision — which option, and
on what timeline — is explicitly left to E, not made by this audit.**

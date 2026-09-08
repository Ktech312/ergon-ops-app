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

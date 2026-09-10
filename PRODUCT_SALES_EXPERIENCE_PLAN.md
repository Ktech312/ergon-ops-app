# Sales Product Experience — Concept Plan (First Pass)

Status: **design-only, first-pass concept produced during an overnight autonomous work session, lighter depth than the other documents produced the same night.** Not implemented. Goal: keep the HubSpot/PandaDoc-equivalent functionality inside Ergon itself, per the stated product direction, rather than building a thin wrapper around either.

## The flow

**Marketing lead → Sales opportunity → quote → presentation/proposal → signature → Billing review → clearance → project conversion → PM handoff.**

Everything from "quote" onward already exists in some real form in this codebase (sales quotes, BOM lines, the proposal system built this session's earlier work touched extensively). The gap is earlier (lead → opportunity, no evidence found of a dedicated stage for this yet) and later (Billing review/clearance/conversion-approval — entirely Stage 2 work, not yet built).

## Screen-level concepts (concept only, not wireframed)

- **Fast quote creation**: a "start from a template" picker at quote-creation time (see Sales templates below), pre-filling BOM structure and boilerplate so a rep isn't building every quote from a blank page.
- **Reusable workspace templates**: template quotes/proposals a rep can clone, distinct from the shared boilerplate `proposal_template_sections` (migration 053) that already exists — templates would be starting *content*, boilerplate is fixed *legal text*. Two different concepts that shouldn't be conflated in the UI.
- **Brand controls**: already partially real (`company_branding`, migration 039) — extend to control the proposal page's own visual presentation (logo placement, accent color) once that's workspace-scoped (Stage 9's onboarding plan).
- **Visual proposal sections**: the current proposal page (`ProposalPublicPage`, extensively traced this session) already renders images per BOM line (`imageUrl`) and structured template sections — a real foundation, not a gap. The concept work here is giving Sales more layout control (section ordering, optional hero image) rather than inventing the rendering pipeline from scratch.
- **Product/media libraries**: the catalog (`product_catalog`) already carries images/descriptions/datasheets per item — reused directly by proposals today. No new library needed; extending catalog item media richness (multiple images, video) is the actual open question.
- **Pricing accuracy**: out of this pass's depth — flagged as needing its own investigation into how BOM-line pricing is currently derived/frozen at quote time vs. catalog price changes afterward (the catalog price-change-request workflow, migrations 046/108, suggests this is already a live concern elsewhere in the app worth cross-referencing).
- **Optional packages**: no evidence found of a "bundle" concept in the current BOM model — a real gap, not yet designed here.
- **Approval workflow**: this is Stage 2's conversion-approval design (`PRODUCT_STAGE2_SCHEMA_PLAN.md` §3) — same underlying mechanism, described from the Sales-experience side here rather than re-designed.
- **Version comparison**: proposals already version (migration 053's `version` column, already extensively used by this session's share-link work) — no side-by-side diff view exists yet; a real, well-scoped future feature.
- **Customer preview**: the existing public proposal page already IS the customer preview (same page a client eventually approves from) — the open question is whether Sales wants a *separate*, non-committing preview mode before actually sending, which doesn't exist today.
- **E-signature**: today's "signature" is a typed name + IP + content-hash (`approval_name`/`approval_ip`/`approval_content_hash`, traced extensively this session) — a real e-signature (drawn signature, third-party like DocuSign) would be a materially bigger feature, not a small extension.
- **View/activity tracking**: directly the share-link decision document's audit-log work (Part 9.4) — same mechanism, Sales-facing framing.
- **Mobile use**: standing, already-enforced requirement (per `HANDOFF.md`) — nothing sales-specific to design, just keep applying the existing discipline.
- **Automatic handoff without re-entry**: directly Stage 2's `project_handoff_records` snapshot mechanism (`PRODUCT_STAGE2_SCHEMA_PLAN.md` §4) — the whole point of that design is that PM never re-types anything Sales already captured.

## Usability risks (flagged, not resolved)

- Version comparison and optional packages are both real, unscoped gaps — building either without a dedicated design pass risks scope creep into the wrong shape.
- Conflating "Sales templates" (starting content) with "proposal boilerplate" (fixed legal text) in one settings screen would confuse who edits what and why — keep them visually and conceptually separate.
- A real e-signature feature is a materially different trust/liability surface than today's typed-name+IP+hash pattern — this needs its own explicit product decision (do you actually need DocuSign-equivalent legal weight, or is the current pattern sufficient for this business?) before any design work, not an assumed yes.

## Recommended representative prototype to build first

**Version comparison on an existing proposal** — narrow, high-value (directly serves the already-real "revision requested" flow this session did extensive replay-safety work on), and doesn't require Stage 2, Billing, or e-signature to exist first. A clean, self-contained next step once the authorization-bridge and share-link work currently in flight is settled.

## What this pass did not do

This is a lighter-depth document than the others produced overnight — it maps the flow against what already exists and flags real gaps, but does not wireframe screens, write user stories, or produce a full information architecture. That would be the natural next step once E confirms this is the direction worth investing further design time in.

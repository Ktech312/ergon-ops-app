# Engineering/Product Development Module — First Design (Queue B8, NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration, no permissions decisions made.** Written for
`CONTINUOUS_CODER_HANDOFF.md` Queue B8. `engineering` and `product_development` already exist as real
role keys (migration 040), each already gated to Inventory-only permissions today
(`rolePermissions.engineering = ["Transfer", "Scan"]`, `product_development = ["View only"]`,
`main.tsx:10115-10116`) — this is their first real module, same situation as Support (Queue B7). Ties
to decision **D14** (§8, "Engineering first release: product/solution request + technical review +
Catalog release link") — this document expands that one line.

## 1. Who uses it, and why two roles not one

`engineering` and `product_development` are already separate role keys, not one combined "R&D" role —
this design keeps that separation rather than merging them, since the existing permission split
already implies different responsibilities: `engineering` gets Inventory `Transfer`/`Scan` (they touch
physical hardware — building/testing a prototype needs real parts), `product_development` gets
`View only` (a more product-management-flavored role: deciding *what* gets built, not building it).
Concretely:

- **Product Development**: intakes and prioritizes requests, defines requirements, decides what
  reaches technical review and in what order.
- **Engineering**: performs technical review, builds/tests prototypes (pulling real inventory via the
  `Transfer`/`Scan` access they already have), and determines release readiness.

Both need visibility into the same underlying request/review records — this is a shared object with
two role-appropriate views, not two separate schemas.

## 2. What already exists (do not re-build)

- **Catalog** (`CatalogItem`, migration 052/053 and later) already models `productName`,
  `specifications`, `datasheetUrl`/`datasheetStoragePath`, `itemType` (`regular`/`bundle`), and a full
  pricing model — a released product's actual Catalog entry, not a new "product" concept. This module
  produces requests that, once released, become (or update) a real `CatalogItem` row — it doesn't
  duplicate Catalog.
- **Projects** already carry `source_sales_quote_id` and BOM lines that reference Catalog items —
  the natural link for "which Project(s) prompted or are waiting on this request."
- **Status/version lifecycle precedent**: same as Support (Queue B7) — `project_submittals`'s
  `status`/`version` shape is the established pattern to reuse for a request's own lifecycle, not a
  new one.
- **Support handoff target**: Queue B7's `support_cases` schema already exists as a design (not yet
  built) — this module's "handoff to Support" is a foreign key onto that table once both are real, not
  a new mechanism.

## 3. Proposed schema (illustrative — not a migration)

```sql
-- Confirm the next free migration number at execution time.
create table product_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,  -- "PR-2026-0001", same generated-ref convention as quotes/projects
  title text not null,
  -- Where this came from -- at least one should usually be set, but
  -- neither is required (an internally-originated idea has neither).
  source_project_id uuid references projects(id),
  source_client_name text,
  requested_by_email text not null,
  status text not null default 'submitted' check (status in (
    'submitted', 'requirements_review', 'technical_review', 'prototyping',
    'release_ready', 'released', 'declined', 'on_hold'
  )),
  requirements text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_request_reviews (
  id uuid primary key default gen_random_uuid(),
  product_request_id uuid not null references product_requests(id) on delete cascade,
  kind text not null check (kind in ('technical_review', 'prototype_test', 'release_readiness')),
  outcome text check (outcome in ('pass', 'fail', 'needs_revision', null)),
  notes text,
  reviewed_by_email text not null,
  reviewed_at timestamptz not null default now()
);

-- Populated only once status reaches 'released' -- the actual link this
-- module exists to produce.
alter table product_requests add column if not exists released_catalog_item_id uuid references product_catalog(id);

-- Handoff to Support, once both modules exist -- a released product with
-- a known issue can open a support case without re-typing its context.
alter table product_requests add column if not exists handed_off_support_case_id uuid; -- references support_cases(id) once Queue B7 is built
```

## 4. First useful feature set

1. **Product/solution requests** — submit a request (title, requirements, optional source
   project/client), visible to `product_development` for triage.
2. **Requirements** — a free-text field this pass (matching `bundle_components`' own free-text
   precedent, D5's still-open question about whether to formalize that pattern — this module doesn't
   pre-empt that decision, it just doesn't need structured requirements yet either).
3. **Technical review** — `engineering` logs a `product_request_reviews` row
   (`kind = 'technical_review'`), moving status to `prototyping` or `on_hold`/`declined`.
4. **Prototype/test results** — further `product_request_reviews` rows
   (`kind = 'prototype_test'`), each with a pass/fail/needs-revision outcome — an append-only history,
   not a single overwritten "latest result" field, so a request that failed once and passed on retry
   keeps both entries visible.
5. **Version/release readiness** — a final `kind = 'release_readiness'` review gates the
   `release_ready → released` transition.
6. **Link to Catalog** — releasing sets `released_catalog_item_id`, either creating a new `CatalogItem`
   row or updating an existing one (e.g. a hardware revision) — which of the two depends on whether
   the request was "new product" or "revise existing product," a distinction the request itself should
   probably carry (not resolved here — flagged as an implementation-time question, not a blocking one).
7. **Link to Projects** — `source_project_id` is set at creation; no further Project-side change is
   proposed this pass (Projects don't need to know about a request's internal review process).
8. **Handoff to Support** — once Queue B7 is built, a released product's request can link forward to
   a `support_cases` row for a known post-release issue, avoiding re-entry of the product context.

## 5. Keeping Engineering delivery work distinct from Project implementation

Explicitly per the task's own instruction: `product_requests` never becomes a Project, and a Project
never becomes a `product_request`. They intersect only via `source_project_id` (a request can *cite* a
project that prompted it) and, once released, via `released_catalog_item_id` (a project's BOM can
*use* the resulting catalog item) — the same arm's-length relationship Sales Quotes already have to
Projects (cited via `source_sales_quote_id`, never merged into one record type). Engineering's own
prototyping/testing work stays inside `product_request_reviews`, never inside a Project's own BOM or
task list.

## 6. Permissions questions (not decided here)

- Can `product_development` create/triage requests but not perform reviews (review stays
  `engineering`-only), matching the read/write split already implied by their current Inventory
  permissions? Recommended, not decided.
- Should Sales or PM be able to *submit* a request (since `source_project_id`/`source_client_name`
  imply a non-Engineering originator) even without holding either Engineering role? Recommended yes
  (submission is lower-stakes than review), not decided.
- Who can perform the final `release_readiness` review and trigger the Catalog write — `engineering`
  alone, or does releasing a priced Catalog item need Sales/Manager sign-off too (pricing implications,
  see `PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md`)? Genuinely open, not decided here.

## 7. Smallest useful first release

Submit a request, technical review with a pass/fail outcome, release into a new or existing Catalog
item. No prototype/test-result sub-stage, no Support handoff link, no formal requirements schema —
all additive later given `product_request_reviews`' `kind` enum and `product_requests.status` enum
already accommodate them without a redesign.

# Marketing-to-Sales — Design (Queue B9, NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration, no HubSpot integration built or promised.**
Written for `CONTINUOUS_CODER_HANDOFF.md` Queue B9. `marketing` already exists as a real role key
(migration 040), gated to Inventory view-only today (`main.tsx:10107`/`:10119`) — this is its first
real module, same situation as Support (B7) and Engineering (B8).

## 1. What already exists (do not re-build)

- **`clients`** (migration 102) — a real, deduplicated entity: `id`, `name` (unique), linked from both
  `sales_quotes.client_id` and `projects.client_id`. Built specifically to stop "client" being a
  repeated free-text field with no dedup, per that migration's own header — the exact same duplication
  risk a Marketing lead/company concept would recreate if this design invented a second, parallel
  "company" table instead of feeding into this one.
- **`sales_quotes`** already carries `clientName`, `siteName`, `city`, `createdByEmail`, `status`
  (`open`/`closed_won`/`closed_lost`) — the real conversion target this design maps into, per the
  task's own instruction ("without re-entry").
- **`PRODUCT_SALES_DISCOVERY.md`** already traced the full Sales workflow in detail (quote → proposal →
  signature → project conversion) — this design does not re-trace that ground, only extends it
  backward to where a quote's very first lead came from.

## 2. What Marketing needs that doesn't exist yet

Nothing upstream of `sales_quotes`/`clients` exists today — no lead, campaign, contact, or
qualification concept anywhere in the schema. This is a genuinely new, additive layer sitting in
front of quote creation, not a modification to the Sales side itself.

## 3. Proposed schema (illustrative — not a migration)

```sql
-- Confirm the next free migration number at execution time.
create table marketing_leads (
  id uuid primary key default gen_random_uuid(),
  -- Nullable, set once a matching/created clients row exists -- a brand
  -- new lead usually has no clients row yet (that's created at
  -- qualification, see §4).
  client_id uuid references clients(id),
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  lead_source text not null,       -- e.g. 'website_form', 'referral', 'trade_show', 'hubspot_import'
  campaign text,
  status text not null default 'new' check (status in (
    'new', 'qualifying', 'qualified', 'disqualified', 'converted'
  )),
  disqualified_reason text,
  owner_email text,
  -- Set only when status = 'converted' -- the actual handoff artifact.
  converted_sales_quote_id uuid references sales_quotes(id),
  -- Deduplication against a prior import/lead for the same real company --
  -- see §6. Null unless a duplicate was actually identified.
  duplicate_of_lead_id uuid references marketing_leads(id),
  -- Distinguishes organically-entered leads from a HubSpot import, so a
  -- re-import never silently duplicates -- see §5.
  external_source text check (external_source in ('hubspot', null)),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_marketing_leads_external
  on marketing_leads(external_source, external_id) where external_source is not null;

create table marketing_lead_activity (
  id uuid primary key default gen_random_uuid(),
  marketing_lead_id uuid not null references marketing_leads(id) on delete cascade,
  kind text not null check (kind in ('note', 'status_change', 'contact_attempt', 'qualification_note')),
  body text,
  actor_email text,
  occurred_at timestamptz not null default now()
);
```

Same append-only activity-table convention already used for Support (B7) and proposed for Engineering
(B8) — one timeline table, not a field-per-event-type design.

## 4. Lead → opportunity → conversion, mapped to today's Sales Quote

1. **Lead capture**: `marketing_leads` row created (`status = 'new'`), `client_id` left null.
2. **Qualification**: Marketing works the lead (`marketing_lead_activity` rows), moves status through
   `qualifying` → `qualified`/`disqualified`. Qualification criteria itself (BANT, a scoring model,
   etc.) is a business decision, not specified here — the schema only needs a status, not a specific
   methodology.
3. **Conversion, without re-entry**: converting a `qualified` lead:
   - Looks up an existing `clients` row by name (case-insensitive match against `company_name`); if
     none exists, creates one — reusing `clients`' existing unique-name constraint, not duplicating it.
   - Creates a new `sales_quotes` row with `client_id` set to that client, `clientName` pre-filled from
     `company_name`, and `siteName`/`city` left for Sales to fill in (Marketing doesn't necessarily
     know the project site yet — that's a Sales-discovery detail, not a Marketing one).
   - Sets `marketing_leads.status = 'converted'` and `converted_sales_quote_id` — the actual "into
     today's Sales Quote without re-entry" link the task asks for; contact name/email/phone carry
     forward as quote-level notes or a linked contact reference (exact field mapping is a UI-layer
     decision, not a schema one — no re-typing either way).
4. **Opportunity** as a separate stage-tracking concept (pipeline value, close probability, forecast
   date) is **not** proposed as new schema — `sales_quotes.status` (open/closed_won/closed_lost)
   already is the opportunity-stage tracker once conversion happens; adding a second, parallel
   "opportunity" object ahead of it would just be `marketing_leads` restated. If a richer, HubSpot-style
   opportunity/pipeline-stage concept is wanted, that is a follow-on decision, not part of this first
   release.

## 5. HubSpot coexistence and import boundaries

Per the task's explicit instruction: **no HubSpot integration is built or promised by this document.**
`external_source`/`external_id` exist only so that *if* a HubSpot export/import is ever built, an
imported lead has a stable dedup key (re-importing the same HubSpot record updates the existing row
instead of creating a duplicate) — this is schema headroom, not a commitment. Until a real
integration decision is made, `marketing_leads` rows are entered manually or via a plain CSV import
tool (out of scope here), coexisting with HubSpot exactly the way `PRODUCT_SALES_DISCOVERY.md` already
describes Sales coexisting with PandaDoc — two systems used side by side until a deliberate migration
decision is made, never a silent one-way sync.

## 6. Deduplication

Two layers, matching the two places a duplicate can actually occur:

- **Against `clients`**: handled by that table's existing `name` unique constraint (case-sensitive
  today — a normalization pass, e.g. trim/case-fold before matching, is worth doing at
  implementation time, mirroring migration 102's own trailing-space cleanup, but is not a schema
  change).
- **Against other `marketing_leads` rows** for the same real company (two different lead sources
  submitting the same company before either is qualified): `duplicate_of_lead_id` records a
  human-confirmed match — **not** an automatic fuzzy-match merge. Matching company names automatically
  is unreliable ("Exxon" vs "Exxon Mobil" vs "Exxon " being the exact class of problem migration 102
  had to fix by hand) — this design defers the same judgment call to a person, same as that migration
  did, rather than guessing.

## 7. What remains genuinely open (not decided here)

- Whether `marketing` should be able to create/edit `sales_quotes` directly post-conversion, or only
  ever hand off and lose write access — a permissions question, not decided per the task's own scope.
- The real qualification methodology/criteria — a business decision.
- Whether/when a real HubSpot integration is ever built — explicitly deferred, per §5.

## 8. Smallest useful first release

Capture a lead, log qualification activity, convert a qualified lead into a new (or existing, via
`clients` lookup) Sales Quote with no re-typed company/contact data. No opportunity/pipeline-stage
object beyond what `sales_quotes.status` already provides, no HubSpot import, no automated
deduplication beyond the `clients` table's existing unique-name constraint.

-- Migration 211: the Dashboard's "Package Matrix" panel (main.tsx,
-- `packageOptions`) is a plain, hardcoded module-level constant --
-- Ergon's own camera-install business presets (FLI Edge VPI, VPU case,
-- solar mounts, etc.), never a database query, never workspace-scoped
-- at all. It renders identically for every workspace. Found live,
-- 2026-09-26, by E directly in K-Tech Systems' own dashboard, right
-- after the real onboarding test finally got a founding admin signed
-- in: "i also see this carry over, this Business should not have any
-- reference." Exactly the thing the original onboarding acceptance
-- spec named explicitly: "never populate a real second company with
-- Ergon-specific starter data."
--
-- This is not a security/RLS gap (no real Ergon customer data leaks --
-- it's static UI content baked into the shared frontend bundle), but it
-- is a real, reusable product defect: every future self-serve company
-- would see this identically, with zero relevance to their own
-- business. "Industry starter catalog/template data" was already
-- flagged elsewhere (CONTINUOUS_CODER_HANDOFF.md) as deliberately
-- deferred, not built -- this migration does not build that; it stops
-- the accidental, undesigned version of it from showing up by default.
--
-- Fix: a real per-workspace flag, not a hardcoded company-name/UUID
-- string comparison in the frontend. Ergon's own workspace is
-- identified structurally, not by name or a hardcoded id: it is the
-- ONE workspace that was never created through company_signup_requests
-- at all (that whole self-serve system postdates Ergon's own workspace
-- by ~80 migrations) -- true for Ergon today, and true for every future
-- self-serve company by construction, with no per-company update ever
-- needed.

begin;

alter table public.company_branding
  add column if not exists show_reference_packages boolean not null default false;

update public.company_branding
set show_reference_packages = true
where workspace_id not in (
  select created_workspace_id
  from public.company_signup_requests
  where created_workspace_id is not null
);

commit;

-- Confirm 211 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept local
-- for E's review.

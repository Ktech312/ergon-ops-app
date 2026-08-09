-- Quote Proposal: a client-facing, e-signable document generated from a
-- Sales Quote's BOM + a shared, admin-editable boilerplate template --
-- built native in-app rather than depending on PandaDoc, per E. Reuses the
-- exact same share-token / security-definer-RPC / click-to-approve pattern
-- already proven by Project Submittals (migration 025), just for a new
-- entity_type and a new source table (sales_quotes instead of projects).
--
-- v1 ships as a public HTML page (same as submittals) with a browser
-- Print/Save as PDF affordance -- no PDF-generation library exists in this
-- app yet, and per E that's the right amount of scope for now.

-- 1. Sales Quote gains what it's missing to send a proposal at all: a
-- client email (SalesQuote only ever had clientName -- no email anywhere)
-- and a per-deal executive-summary paragraph (the one genuinely
-- hand-written part of the document -- everything else is either pulled
-- from the BOM or from the shared boilerplate template below).
alter table sales_quotes add column if not exists client_email text;
alter table sales_quotes add column if not exists proposal_summary text;

-- 2. BOM lines can OPTIONALLY link to a real catalog item. Deliberately
-- nullable: real EnSight proposals mix real product rows (with photos,
-- pulled from the catalog item's image/description/datasheet) with
-- labor/service rows like "Project Management Hours" or "Travel and
-- Related Expenses" that have no catalog item at all -- those keep
-- rendering as plain text+qty, same as today.
alter table sales_quote_bom_lines add column if not exists catalog_item_id uuid references product_catalog(id) on delete set null;

-- 3. Shared boilerplate template -- the sections that were nearly
-- word-for-word identical across both real EnSight proposals E shared
-- (Project Plan and Performance, Responsibilities Matrix, Assumptions and
-- Exclusions, Warranty, Payment Terms, SSSA Term Details, System
-- Sustainability Commitment). One row per section, edited in a new Admin
-- screen, reused by every proposal sent -- change the wording once, every
-- future proposal picks it up. Seeded below with real EnSight boilerplate
-- text (generalized -- dates/numbers that were deal-specific in the
-- source PDFs are written as the standard terms, not a specific deal's
-- numbers) so this isn't an empty template on day one.
create table if not exists proposal_template_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text not null unique,
  title text not null,
  body text not null default '',
  sequence_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table proposal_template_sections enable row level security;

create policy "authenticated read proposal_template_sections"
  on proposal_template_sections for select to authenticated using (true);

-- Shared, sent-with-every-proposal legal/company text -- gated the same
-- way Product Catalog writes are (migration 033), so a rep can't
-- accidentally rewrite the company's warranty language.
create policy "admin/manager write proposal_template_sections"
  on proposal_template_sections for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('manager'))
  with check (is_app_admin(auth.uid()) or has_role('manager'));

insert into proposal_template_sections (section_key, title, body, sequence_order) values
(
  'project_plan',
  'Project Plan And Performance',
  E'1. Preparation\nPrior to mobilizing on-site, EnSight and the client will agree upon the functional specification of the system and all use cases for how the system will operate. Once the functional specification is agreed to, EnSight will order all the equipment for the project. The equipment arrives at the EnSight office where it is programmed and undergoes factory acceptance testing. Once configured, the installation start date will be agreed to with the client.\n\n2. Infrastructure\nConduit for the Cat6 cables running to each camera, sign, and back to the on-site server. Signage will require 120VAC to be completed before installation by EnSight''s local electrical subcontractor.\n\n3. Installation\nThe client''s electrician installing the equipment will mobilize a technician team to install the EnSight system. Installation timelines vary by project size.\n\n4. Commissioning\nOnce all equipment is installed and connected to the network, the commissioning process begins: setting the fields of view for all cameras, installing the FLI software module for counting, confirming all cameras are generally counting, and pushing data to the Aggregator and EnSightful Portal. During commissioning the signage will say "OPEN" while count data is verified on the back end, but counts are not displayed publicly until accuracy has been fine-tuned.\n\n5. Fine Tuning\nOnce the system is commissioned, fine-tuning begins. During this period our team tests and audits the system results. Once accuracy rates are optimized, EnSight will agree on a go-live date with the client, where the signs will be turned on to display parking occupancy.',
  10
),
(
  'responsibilities_matrix',
  'Responsibilities Matrix',
  E'EnSight:\n- Remote project management\n- System programming, testing, fine-tuning, and go-live\n- System training and handoff to the EnSight client success team\n\nClient:\n- Provide adequate internet connection and speed per EnSight specification (no less than 20Mbps up / 20Mbps down)\n- Coordinate site access and safe working conditions for the client''s electrician installing the equipment\n- Facilitate network infrastructure installation for the EnSight System\n- System layout design and lining out the client''s installation contractor\n\nOther (Client''s Electrical Contractor):\n- Bring and land 120V power to each sign from the source\n- Installation of conduit and communication cabling between all cameras, signs, and server locations\n- Installation, mounting, and final terminations of all technology equipment',
  20
),
(
  'assumptions_exclusions',
  'Assumptions And Exclusions',
  E'Assumptions:\n- EnSight will utilize the existing server rack and UPS assumed to be installed in the site''s data closet.\n- Client is providing managed switches and any other network equipment.\n- EnSight System is to be segmented off the client''s main network.\n- Client will allow EnSight to use its standard remote access utility to access on-site servers for implementation, commissioning, and on-going support.\n- Signage power should be 120V.\n- This proposal does not account for rework or remobilization caused by third parties -- such events will be billed at time and materials.\n- Pricing is valid for 60 days from the date the first revision of this document is sent.\n- 2-year warranty on hardware unless otherwise stated on a specific item in the pricing table.\n- Includes EnSight''s standard insurance limits.\n- Annual Software and Support Services Agreement required to ensure integrity, accuracy rates, and upkeep of the camera counting system. Shipping is included.\n\nExclusions:\n- Tax\n- Installation and infrastructure\n- Switches, routers, WAPs, and UPSs\n- Scanning or X-raying\n- Bonds, permits, certifications, engineered drawings, foundation design, etc.',
  30
),
(
  'warranty',
  'Warranty',
  E'ENSIGHT Hardware Warranty. ENSIGHT warrants that Hardware provided and installed by ENSIGHT will materially conform to the applicable Statement of Work. The Warranty Remedy Period for Hardware is twenty-four (24) months from delivery of equipment to the site.\n\nProfessional Services Warranty. ENSIGHT warrants that all Professional Services will be performed in a professional and workmanlike manner and will materially conform to the applicable Statement of Work. The Warranty Remedy Period for Professional Services ends ninety (90) days after completion of Professional Services by phase.\n\nSoftware Warranty. Software is under warranty for the duration of the Software and Support Services Agreement (SSSA), signed in addition to this proposal.\n\nHardware and Services Remedy. If a nonconformity is discovered during the applicable Warranty Remedy Period, under normal and proper use, and written notice is provided to ENSIGHT promptly within that period, ENSIGHT will, at its option, repair or replace the nonconforming Hardware, re-perform the nonconforming Professional Services, or refund the applicable portion of the price.\n\nExceptions. ENSIGHT has no obligation with respect to Hardware that has been improperly stored, repaired, or altered; subjected to misuse, negligence, or accident; used contrary to ENSIGHT''s instructions; or comprised of materials or a design specified by the client. Hardware supplied by ENSIGHT but manufactured by others is warranted only to the extent of the manufacturer''s warranty.\n\nTHE FOREGOING WARRANTIES ARE EXCLUSIVE AND IN LIEU OF ALL OTHER WARRANTIES, WHETHER WRITTEN, ORAL, OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. ENSIGHT DOES NOT WARRANT THAT THE SOFTWARE OR MANAGED SERVICES WILL PERFORM WITHOUT INTERRUPTION OR ERROR, AND WILL NOT BE LIABLE FOR FAILURE DUE TO WEATHER, LABOR STRIKES, CORROSION, INTERNET FAILURE, OR TELECOMMUNICATIONS ERRORS.',
  40
),
(
  'payment_terms',
  'Payment Terms',
  E'Client shall pay ENSIGHT the Contract Price, as may be amended by change order, as full compensation for the Work, as follows:\n\n1. Upon SOW execution and receipt of ENSIGHT invoice, Client shall pay fifty percent (50%) of the total Project Price.\n2. Upon shipment of configured equipment to the Client location and receipt of ENSIGHT invoice, Client shall pay forty percent (40%) of the total Project Price.\n3. Upon Substantial Completion of the Work and receipt of ENSIGHT''s final invoice, Client shall pay all remaining amounts.\n\nThe Annual Software and Support Services Agreement (SSSA) is due and payable annually in advance upon Substantial Completion of the Work.\n\nSSSA Term Details: the initial SSSA term begins upon Substantial Completion (the "Commencement Date") and continues for five (5) years (the "Expiration Date"). Each following year within the initial term is billed annually in advance on the Commencement Date anniversary. The Agreement Price automatically increases by CPI (Consumer Price Index for All Urban Consumers) + 4% for each renewal term, and will not otherwise increase within the initial 5-year term unless the scope increases via an executed change order.',
  50
),
(
  'sustainability',
  'System Sustainability: Software And Support Services Agreement (SSSA)',
  E'The EnSight Client Service Center (CSC) is available to clients during working hours, with the support team on call for emergency requests. The CSC combines people, tools, and processes to ensure deployed systems maintain the highest availability possible.\n\nKey Service & Support Functions:\n- Proactive monitoring and validation of system events and alert conditions\n- Emergency remote service calls\n- System software upgrades and updates (included with the Annual SSSA)\n- Incident tracking and reporting tools\n- Client training and access to the EnSight Digital Training Library\n- Monthly system reports emailed for review\n- Cloud license for the EnSightful Portal (live dashboard, historical reporting, system health monitoring)\n- EnSight Eyes Fluid Learning Intelligence (FLI) camera licenses, including all new releases to enhance counting logic and predictive analytics',
  60
)
on conflict (section_key) do nothing;

-- 4. The proposal itself -- mirrors project_submittals (migration 025)
-- almost exactly: a frozen content_snapshot at send time, status,
-- approval audit trail (name + IP + content hash), but sourced from a
-- sales_quote instead of a project.
create table if not exists sales_quote_proposals (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references sales_quotes(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected', 'revision_requested')),
  content_snapshot jsonb not null default '{}'::jsonb,
  client_name text,
  client_email text,
  sent_at timestamptz,
  responded_at timestamptz,
  response_notes text,
  approval_name text,
  approval_ip text,
  approval_content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_proposals_quote on sales_quote_proposals(quote_id, version desc);

alter table sales_quote_proposals enable row level security;

create policy "authenticated read sales_quote_proposals"
  on sales_quote_proposals for select to authenticated using (true);

-- Sales Quotes themselves are writable by any authenticated user
-- (migration 033) -- proposals follow the same openness rather than the
-- tighter pm/admin gate submittals use, since that's the existing norm on
-- the sales side of this app.
create policy "authenticated write sales_quote_proposals"
  on sales_quote_proposals for all to authenticated using (true) with check (true);

-- 5. Widen public_share_tokens for the new entity type (check constraints
-- aren't additive in Postgres -- drop and re-add with the old value plus
-- the new one).
alter table public_share_tokens drop constraint if exists public_share_tokens_entity_type_check;
alter table public_share_tokens add constraint public_share_tokens_entity_type_check
  check (entity_type in ('project_submittal', 'project_progress', 'sales_quote_proposal'));

-- 6. Public RPCs -- same shape as get_submittal_by_token/respond_to_submittal
-- (migration 025): security-definer, callable by anon with just a token,
-- return only sanitized fields (never quote internal cost/markup data --
-- content_snapshot is built client-side at send time to already exclude
-- that, see persistence.ts).
create or replace function get_quote_proposal_by_token(share_token text)
returns table (
  proposal_id uuid,
  status text,
  version integer,
  content_snapshot jsonb,
  client_name text
)
language sql
security definer
stable
as $$
  select p.id, p.status, p.version, p.content_snapshot, p.client_name
  from public_share_tokens t
  join sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());
$$;

grant execute on function get_quote_proposal_by_token(text) to anon, authenticated;

create or replace function respond_to_quote_proposal(share_token text, new_status text, approver_name text, approver_ip text, notes text)
returns void
language plpgsql
security definer
as $$
declare
  target_id uuid;
  snapshot jsonb;
begin
  if new_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Invalid proposal response status';
  end if;

  select p.id, p.content_snapshot into target_id, snapshot
  from public_share_tokens t
  join sales_quote_proposals p on p.id = t.entity_id
  where t.token = share_token
    and t.entity_type = 'sales_quote_proposal'
    and (t.expires_at is null or t.expires_at > now());

  if target_id is null then
    raise exception 'Invalid or expired proposal link';
  end if;

  update sales_quote_proposals
  set status = new_status,
      responded_at = now(),
      response_notes = notes,
      approval_name = approver_name,
      approval_ip = approver_ip,
      approval_content_hash = encode(sha256(snapshot::text::bytea), 'hex'),
      updated_at = now()
  where id = target_id;
end;
$$;

grant execute on function respond_to_quote_proposal(text, text, text, text, text) to anon, authenticated;

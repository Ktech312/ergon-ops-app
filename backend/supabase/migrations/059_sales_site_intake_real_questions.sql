-- Replaces the 4 starter placeholder questions from migration 058 (which
-- were explicitly documented there as "placeholders to add to from Admin,
-- not the final question set") with E's real Parking Systems Sales
-- Prerequisites & Intake Form. The old placeholders overlapped with this
-- real set (decision_maker/timeline/network_readiness all reappear here in
-- fuller form), so removing them first avoids duplicate/conflicting
-- questions. Reps can still add/edit/reorder further from Admin -> Form
-- Builder -- nothing here is hardcoded in the app.
--
-- form_schema_fields.field_type is constrained to
-- ('text','textarea','number','select','checkbox','date') -- there's no
-- multi-select/checkbox-group type. Every question in the source doc that
-- was a "pick one of N" list maps to 'select'. Section 6 ("what can you
-- provide") is genuinely pick-any-of-3, so it's modeled as three
-- independent boolean 'checkbox' fields instead of one field. "Garage
-- Structure Layout" also had an embedded sub-question (levels count for
-- the indoor option) -- that's split into its own number field
-- (garage_level_count) since a field can't conditionally contain another
-- field in this engine.

delete from form_schema_fields
where form_schema_id = (select id from form_schemas where form_key = 'sales_site_intake')
  and field_key in ('decision_maker', 'timeline', 'existing_cameras', 'network_readiness');

insert into form_schema_fields (form_schema_id, section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
select fs.id, v.section, v.field_key, v.label, v.field_type, v.placeholder, v.is_required, v.options::jsonb, v.sequence_order
from form_schemas fs
cross join (values
  -- 1. Client & Contact Details
  ('client_contact', 'full_name', 'Full Name', 'text', null, true, '[]', 0),
  ('client_contact', 'company_name', 'Company Name', 'text', null, true, '[]', 1),
  ('client_contact', 'business_email', 'Business Email', 'text', null, true, '[]', 2),
  ('client_contact', 'phone_number', 'Phone Number', 'text', null, true, '[]', 3),
  ('client_contact', 'preferred_communication', 'Preferred Communication Method', 'select', null, false,
    '["Email", "Phone Call", "Video Meeting (Zoom/Teams)"]', 4),

  -- 2. Camera Infrastructure & Monitoring Scope
  ('camera_scope', 'entry_exit_lanes', 'Main Entry & Exit Points: how many vehicular lanes need entrance/exit camera coverage?', 'number', 'Total lanes', false, '[]', 5),
  ('camera_scope', 'perimeter_camera_intent', 'Perimeter Camera Intent: what is the primary function of the gate cameras?', 'select', null, false,
    '["Standard High-Definition security recording", "License Plate Recognition (LPR) to automate gate access or log plates"]', 6),
  ('camera_scope', 'level_transition_points', 'Level-to-Level Traffic: how many internal transition points (ramps or deck-to-deck thresholds) need level-monitoring cameras?', 'number', 'Total transition points', false, '[]', 7),
  ('camera_scope', 'stall_level_monitoring', 'Stall-Level Monitoring (Optional Add-On): do you want to monitor individual parking spots?', 'select', null, false,
    '["Yes, via camera sensors (visual overhead lights and video streaming)", "Yes, via ultrasonic/geomagnetic sensors (space tracking only, no video)", "No, gate and level-by-level ramp monitoring is sufficient"]', 8),

  -- 3. Exterior & Interior Guidance Signage
  ('signage', 'exterior_monument_signage', 'Exterior Monument Signage: do you require an outdoor monument sign at the main entrance?', 'select', null, false,
    '["Yes, a static sign (branding and facility name only)", "Yes, a dynamic LED sign (displays real-time OPEN/FULL or total available spaces)", "No exterior signage needed"]', 9),
  ('signage', 'internal_level_guidance_signs', 'Internal Level Guidance Signs: what type of signage is required inside the garage to direct customers to certain levels?', 'select', null, false,
    '["Digital LED space-counter signs (e.g. Level 2: 45 Spaces Available) positioned at ramps", "Static directional signage (e.g. printed arrows pointing to specific levels)"]', 10),
  ('signage', 'internal_sign_count', 'How many total digital internal signs do you estimate needing across the facility?', 'number', 'Internal signs', false, '[]', 11),

  -- 4. Technical Infrastructure & Site Details
  ('technical_infrastructure', 'garage_structure_layout', 'Garage Structure Layout', 'select', null, false,
    '["Indoor multi-level concrete garage", "Open-air outdoor surface lot with light poles"]', 12),
  ('technical_infrastructure', 'garage_level_count', 'If indoor multi-level concrete garage: number of levels', 'number', 'Number of levels', false, '[]', 13),
  ('technical_infrastructure', 'power_data_availability', 'Power & Data Availability for Signs', 'select', null, false,
    '["Power and network lines are available at the sign locations", "Power is available, but data lines need to be run", "No infrastructure is currently routed for signage locations"]', 14),

  -- 5. Budget, Timeline & Decision Authority
  ('budget_timeline', 'budget_range', 'What is your expected budget or price range for this integrated system (cameras + signs)?', 'select', null, false,
    '["Under $40,000", "$40,000 - $100,000", "$100,000 - $250,000", "$250,000+"]', 15),
  ('budget_timeline', 'decision_authority', 'Are you the primary decision-maker with purchasing authority for this project?', 'select', null, false,
    '["Yes, I have direct purchasing authority", "No, I am gathering info to present to the board/owner/executive team"]', 16),
  ('budget_timeline', 'target_timeframe', 'What is your target completion timeframe for the installation?', 'select', null, false,
    '["Immediate (within 3 months)", "Standard (3 to 6 months)", "Long-term planning / budgeting phase"]', 17),

  -- 6. Immediate Next Steps Required
  ('next_steps', 'can_provide_blueprints', 'I can provide AutoCAD or PDF architectural blueprints showing all entry/exit points, internal ramps, and preferred sign locations', 'checkbox', null, false, '[]', 18),
  ('next_steps', 'can_provide_photos', 'I can provide clear photos of the entry gates, exterior entrance area, and internal level transitions', 'checkbox', null, false, '[]', 19),
  ('next_steps', 'needs_site_survey', 'I do not have drawings yet and need a site survey', 'checkbox', null, false, '[]', 20)
) as v(section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
where fs.form_key = 'sales_site_intake'
on conflict (form_schema_id, field_key) do nothing;

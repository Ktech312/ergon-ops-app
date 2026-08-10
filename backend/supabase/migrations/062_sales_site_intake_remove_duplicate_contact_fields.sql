-- Client & Contact Details (full_name, company_name, business_email,
-- phone_number, preferred_communication) are now structured columns on
-- sales_quotes (migrations 060/061) and rendered directly by the shared
-- SiteContactFields component at the top of both the New/Edit Site sheet
-- and the Site Intake Questionnaire. Keeping them as separately
-- admin-editable dynamic-form fields (migration 059) would let someone
-- edit/reorder a question that no longer renders anywhere -- remove them
-- from the questionnaire's field set. The remaining fields (camera scope,
-- signage, technical infrastructure, budget/timeline, next steps) stay,
-- since those genuinely don't have dedicated columns.
delete from form_schema_fields
where form_schema_id = (select id from form_schemas where form_key = 'sales_site_intake')
  and field_key in ('full_name', 'company_name', 'business_email', 'phone_number', 'preferred_communication');

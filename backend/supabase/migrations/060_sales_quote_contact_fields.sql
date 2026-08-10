-- E asked for the Site Intake Questionnaire's "Client & Contact Details"
-- fields (Full Name, Company Name, Business Email, Phone Number, Preferred
-- Communication Method) to also live on the quick New Site / Edit Site
-- sheet, so a rep only has to type them once. Company Name already maps to
-- client_name and Business Email already maps to client_email (migration
-- 053) -- only Full Name, Phone Number, and Preferred Communication Method
-- are genuinely new columns.
alter table sales_quotes add column if not exists contact_full_name text;
alter table sales_quotes add column if not exists contact_phone text;
alter table sales_quotes add column if not exists preferred_communication text;

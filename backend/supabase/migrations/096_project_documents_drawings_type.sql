-- Migration 096: add "Drawings" as a real Project Documents category.
--
-- E: "Good to have a separate section for Drawings or within project
-- documents a sub folder for drawings, submittals, etc." Submittals is
-- already a fully separate feature (own table, review/response tracking),
-- not a documents sub-folder -- this adds Drawings as a real document type
-- so the existing Project Documents list can group by type instead of
-- being a flat list, and drawings specifically have a home distinct from
-- generic "Project" documents and from Closeout's final As-Built Diagram.

alter table project_documents drop constraint if exists project_documents_document_type_check;
alter table project_documents
  add constraint project_documents_document_type_check
  check (document_type in (
    'sales_quote', 'sow', 'bom', 'purchase_order', 'invoice', 'field_photo', 'other', 'purchasing', 'project',
    'drawings',
    'as_built', 'om_manual', 'completion_certificate', 'network_schema', 'power_schedule'
  ));

-- Lets each Site Builder photo carry its own short description, entered
-- from the phone right after it's taken (part of the custom in-app camera
-- batch-capture flow).

alter table sales_quote_location_images add column if not exists description text;

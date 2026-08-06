-- First-login welcome slideshow flag. Defaults to false for anyone new so
-- the walkthrough shows exactly once, but existing accounts (everyone who
-- was already using Ergon before this shipped) are backfilled to true so
-- they aren't suddenly interrupted by an onboarding flow for an app they
-- already know.

alter table app_user_status add column if not exists has_seen_welcome boolean not null default false;

update app_user_status set has_seen_welcome = true where has_seen_welcome = false;

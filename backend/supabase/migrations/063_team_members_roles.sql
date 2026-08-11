-- E's feedback: "I should also be able to click on their information and
-- assign them to groups." Team Roster entries (team_members) aren't tied to
-- a real logged-in account/user_id, so they can't use the existing
-- role/user_roles system, which only applies to knownUsers. Give
-- team_members their own role tags instead, so a roster member can be
-- grouped (PM, Warehouse, Sales, etc.) for organization and future
-- group-based task assignment even before they ever log in.
alter table team_members add column if not exists primary_role text;
alter table team_members add column if not exists secondary_roles text[] not null default '{}';

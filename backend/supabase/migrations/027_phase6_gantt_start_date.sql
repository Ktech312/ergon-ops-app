-- Phase 6 addendum: Gantt view. The only thing missing to draw a timeline
-- bar per task is a persisted start date -- due dates already exist and
-- Phase 11's schedule generation already computes a due date per phase from
-- cumulative standard hours. This just gives that same calculation
-- somewhere to write the start of that window.

alter table tasks
  add column if not exists start_date date;

-- STUDIO, THE SERVER HALF (WEB 11-18; Ryan Q639 yes: a 'Coming soon' department for a podcast's camera crew + live editor, working name Studio).
-- NOT APPLIED: a migration for CC1's review; applying it is a LIVE SQL step and comes back to Ryan as its own row. The page (assets/app-departments.js) already knows the id 'studio' and ignores
-- it until this row exists, so deploying the page first is harmless: no row, no Studio in the bar.
--
-- Adds ONE row to public.departments, status 'soon', after Animation Studio (sort 50). Nothing else: the interest table, the functions and the rules are the ones from 20261027000100_departments.sql
-- ('Tell me when it's ready' stores only owner, department, time; nothing is sent). Idempotent: a second run changes nothing.
-- Undo: supabase/rollbacks/20261118000100_department_studio_rollback.sql (it also removes the 'Tell me when it's ready' rows for studio).

begin;

insert into public.departments (id, label, status, needs_local_compute, sort) values
  ('studio', 'Studio', 'soon', false, 60)
  on conflict (id) do nothing;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused here like everywhere else

commit;

-- THE STUDIO DEPARTMENT ROW (CONNECT, 2026-11-18; Ryan's Q639 yes, 2026-11-17 22:4x: "Studio" is shown in the top bar and in the AI's home panel as Coming soon, with his own words).
-- NOT APPLIED: a LIVE STEP Ryan takes (it adds one row to the live departments table). It ADDS ONE ROW and changes nothing else (it ends with the gate line every migration ends with): no function, no table, no grant, no trigger, nothing that sends anything.
-- The row: id 'studio', label 'Studio', status 'soon', needs_local_compute false, sort 60 (after Animation Studio, which is sort 50). The site (assets/app-departments.js, WEB's head) and the connector's
-- home panel (connect-core/home_panel.ts) hold the WORDS for the id; until a person's list has a 'studio' row neither shows anything new, so this file is the switch that makes both appear.
-- The people it is shown to are the ones who already see departments: invited accounts only (my_departments() and its connector twin answer [] for anyone else).
-- Safe to run twice: the insert does nothing when the row is there. Needs 20261027000100_departments.sql. Check: supabase/live-steps/29_department_studio_after_check.sql. Undo: supabase/rollbacks/20261118000100_department_studio_rollback.sql.

begin;
insert into public.departments (id, label, status, needs_local_compute, sort) values ('studio', 'Studio', 'soon', false, 60) on conflict (id) do nothing;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (nothing here is a function or a table, so the gate has nothing to close; the rule is that the line is always last)
commit;

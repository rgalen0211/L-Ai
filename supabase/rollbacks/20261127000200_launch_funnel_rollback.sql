-- THE EXACT UNDO of migrations/20261127000200_launch_funnel.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It drops the one read-only function. Nothing else changes: the function wrote nothing and kept nothing. Ends with gate_apply.
begin;
drop function public.admin_launch_funnel(int);

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

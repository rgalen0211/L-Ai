-- STUDIO, THE SERVER HALF: the exact undo of supabase/migrations/20261118000100_department_studio.sql. NOT a migration: it lives outside migrations/ on purpose.
-- It removes the Studio row and every 'Tell me when it's ready' row for it (department_interest cascades, deleted first here to be explicit). Nothing else.
begin;
delete from public.department_interest where department = 'studio';
delete from public.departments where id = 'studio';
commit;

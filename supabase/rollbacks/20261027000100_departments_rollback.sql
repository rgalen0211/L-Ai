-- DEPARTMENTS, THE SERVER HALF: the exact undo of supabase/migrations/20261027000100_departments.sql (NEXT-WEB 147 piece 2). NOT a migration: it lives outside migrations/ on purpose.
-- It LOSES the departments list and every 'Tell me when it's ready' row (nothing else; the page then shows no departments bar because my_departments() is gone, and today's header is unchanged).
begin;
drop function if exists public.admin_department_interest_counts();
drop function if exists public.withdraw_department_interest(text);
drop function if exists public.register_department_interest(text);
drop function if exists public.my_department_interests();
drop function if exists public.my_departments();
drop function if exists ryagram_private.departments_for(uuid);
drop function if exists ryagram_private.department_person_ok(uuid);
drop table if exists public.department_interest;
drop table if exists public.departments;
commit;

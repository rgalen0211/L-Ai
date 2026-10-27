-- AFTER Q262 B (20261027000100_departments.sql): one SELECT, read-only. Every ok must be true. (Independent of the other steps; WEB's page that uses it stays behind its flag, off.)
select 'both tables exist with row level security on, and nobody can touch them directly (not signed-in people, not the public, not the service role)' as check_name,
       to_regclass('public.departments') is not null and to_regclass('public.department_interest') is not null
       and (select count(*) from pg_class c where c.oid in ('public.departments'::regclass, 'public.department_interest'::regclass) and c.relrowsecurity) = 2
       and not has_table_privilege('authenticated', 'public.departments', 'select,insert,update,delete')
       and not has_table_privilege('anon', 'public.departments', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.departments', 'select,insert,update,delete')
       and not has_table_privilege('authenticated', 'public.department_interest', 'select,insert,update,delete')
       and not has_table_privilege('anon', 'public.department_interest', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.department_interest', 'select,insert,update,delete') as ok
union all select 'the five departments are seeded: Data films working, the other four soon',
       (select count(*) from public.departments) = 5
       and (select status from public.departments where id = 'data_films') = 'working'
       and (select count(*) from public.departments where status = 'soon') = 4
union all select 'no interest row exists yet',
       (select count(*) from public.department_interest) = 0
union all select 'the five page functions exist for signed-in people and not for the public',
       (select count(*) from unnest(array['public.my_departments()', 'public.my_department_interests()', 'public.register_department_interest(text)',
                                          'public.withdraw_department_interest(text)', 'public.admin_department_interest_counts()']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 5;

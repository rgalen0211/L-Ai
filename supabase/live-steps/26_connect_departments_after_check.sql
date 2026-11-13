-- AFTER 20261113000200_connect_departments.sql (the person's departments for the AI's home panel): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the rows answer false, never an error. Every column is named.
select 'connect_my_departments(text) exists and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_my_departments(text)')), false) as ok
union all select 'it reads the token''s own person (connect_actor, scope read) and the one rule the site uses (departments_for)',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''read'')%' and p.prosrc like '%ryagram_private.departments_for(me)%' from pg_proc p where p.oid = to_regprocedure('public.connect_my_departments(text)')), false)
union all select 'it is security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_my_departments(text)')), false)
union all select 'ONLY the connector login can run it: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_my_departments(text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_my_departments(text)', 'execute') and not has_function_privilege('anon', 'public.connect_my_departments(text)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_my_departments(text)', 'execute') and not has_function_privilege('node_runner', 'public.connect_my_departments(text)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_my_departments(text)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_my_departments(text)') is not null), false)
union all select 'the departments table is still closed to every API role',
       not (has_table_privilege('anon', 'public.departments', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.departments', 'select, insert, update, delete')
            or has_table_privilege('service_role', 'public.departments', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.departments', 'select, insert, update, delete'));

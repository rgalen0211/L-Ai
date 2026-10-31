-- AFTER 20261031000100_admin_tester_devices.sql (the admin's list of each tester's computers): one SELECT, read-only. Every ok must be true.
select 'the function exists' as check_name, to_regprocedure('public.admin_tester_devices()') is not null as ok
union all select 'only a signed-in person can run it (not anon, not the render node, not the connector)',
       case when to_regprocedure('public.admin_tester_devices()') is null then false else
         has_function_privilege('authenticated', 'public.admin_tester_devices()', 'execute')
         and not has_function_privilege('anon', 'public.admin_tester_devices()', 'execute')
         and not has_function_privilege('node_runner', 'public.admin_tester_devices()', 'execute')
         and not has_function_privilege('connect_runner', 'public.admin_tester_devices()', 'execute') end
union all select 'it only reads: it is stable and runs as its owner with a fixed search path',
       coalesce((select p.provolatile = 's' and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')
                 from pg_proc p where p.oid = to_regprocedure('public.admin_tester_devices()')), false);

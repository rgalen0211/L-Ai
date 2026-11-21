-- AFTER 20261120000600_prepared_purge_daily.sql (the daily purge also removes expired AI-prepared tables): one SELECT, read-only, changes nothing. Every ok must be true. Before the migration every row answers false, never an error. Every column is named.
select 'connect_purge exists and still answers its original keys, the editor key and the new prepared key' as check_name,
       coalesce(to_regprocedure('public.connect_purge()') is not null
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''requests'', a%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''edit'', e%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''prepared'', f%', false) as ok
union all select 'it calls the prepared purge, guarded, so a failure there cannot stop the rest',
       coalesce(pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%to_regprocedure(''ryagram_private.prepared_purge()'')%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%ryagram_private.prepared_purge()%exception when others%', false)
union all select 'nobody but the database owner and the dashboard can run connect_purge (anon, signed-in and the connector login cannot)',
       coalesce(to_regprocedure('public.connect_purge()') is not null
         and not has_function_privilege('anon', to_regprocedure('public.connect_purge()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_purge()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('public.connect_purge()'), 'execute'), false)
union all select 'the prepared purge itself is closed to every API role',
       coalesce(to_regprocedure('ryagram_private.prepared_purge()') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.prepared_purge()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.prepared_purge()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('ryagram_private.prepared_purge()'), 'execute'), false);

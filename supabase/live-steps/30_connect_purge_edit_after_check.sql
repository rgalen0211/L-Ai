-- AFTER 20261120000100_connect_purge_edit.sql (the daily connector purge also runs the live editor's purge): one SELECT, read-only, changes nothing. Every ok must be true. NOT APPLIED; UNRUN against a database.
-- Run it on the same project right after the migration. Before the migration the first two rows answer false, never an error. Every column is named.
select 'connect_purge exists with no arguments and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false) as ok
union all select 'connect_purge now runs the live editor''s purge (it names ryagram_private.edit_purge) and still answers its four counts',
       coalesce((select p.prosrc like '%ryagram_private.edit_purge()%' and p.prosrc like '%''requests'', a%' and p.prosrc like '%''calls'', d%' from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 'connect_purge still deletes the same old rows (requests, codes, spent tokens, calls over 30 days, buckets, clients nobody signed in to)',
       coalesce((select p.prosrc like '%delete from public.connect_requests%' and p.prosrc like '%delete from public.connect_codes%' and p.prosrc like '%delete from public.connect_tokens%'
                   and p.prosrc like '%delete from public.connect_calls%' and p.prosrc like '%delete from public.connect_buckets%' and p.prosrc like '%delete from public.connect_clients%'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 'connect_purge is still security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 'connect_purge is for the database owner and the dashboard only: not signed-in people, not the public, not the connector login, not the computer login (the service role keeps the platform''s default, as before)',
       coalesce((select not has_function_privilege('connect_runner', 'public.connect_purge()', 'execute') and not has_function_privilege('authenticated', 'public.connect_purge()', 'execute')
                   and not has_function_privilege('anon', 'public.connect_purge()', 'execute') and not has_function_privilege('node_runner', 'public.connect_purge()', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_purge()') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_purge()') is not null), false)
union all select 'the live editor''s purge itself is still private (nobody can run it directly)',
       coalesce((select not has_function_privilege('authenticated', 'ryagram_private.edit_purge()', 'execute') and not has_function_privilege('anon', 'ryagram_private.edit_purge()', 'execute')
                   and not has_function_privilege('service_role', 'ryagram_private.edit_purge()', 'execute') and not has_function_privilege('connect_runner', 'ryagram_private.edit_purge()', 'execute')
                 where to_regprocedure('ryagram_private.edit_purge()') is not null), true);

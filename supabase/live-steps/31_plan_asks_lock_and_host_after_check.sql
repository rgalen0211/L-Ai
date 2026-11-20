-- AFTER 20261120000200_plan_asks_lock_and_host.sql (one ask at a time per person for download and footage plans; a download host must be a real name): one SELECT, read-only, changes nothing. Every ok must be true. NOT APPLIED; UNRUN against a database.
-- Run it on the same project right after the migration. Before the migration the first four rows answer false, never an error. Every column is named. A project without the footage plans migration answers false in the footage rows only.
select 'connect_request_download takes the per-person lock before it counts' as check_name,
       coalesce((select p.prosrc like '%pg_advisory_xact_lock(hashtextextended(''download:'' || me::text, 0))%'
                   and position('pg_advisory_xact_lock' in p.prosrc) < position('select count(*) into waiting' in p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false) as ok
union all select 'connect_request_download refuses a host whose last label is not a name or whose last label is localhost, local, internal or lan',
       coalesce((select strpos(p.prosrc, 'host !~ ''\.[a-z][a-z0-9-]*$''') > 0 and strpos(p.prosrc, '(localhost|local|internal|lan)') > 0 from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false)
union all select 'connect_request_download keeps its limits (5 waiting, 20 a day) and the scope fetch_data',
       coalesce((select p.prosrc like '%waiting >= 5%' and p.prosrc like '%today >= 20%' and p.prosrc like '%connect_actor(p_token_hash, ''fetch_data'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false)
union all select 'connect_request_footage takes the per-person lock before it looks for the same item and counts',
       coalesce((select p.prosrc like '%pg_advisory_xact_lock(hashtextextended(''footage:'' || me::text, 0))%'
                   and position('pg_advisory_xact_lock' in p.prosrc) < position('select * into same' in p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.connect_request_footage(text,text,text,text)')), false)
union all select 'connect_request_footage still refuses while the switch is off and keeps its limits',
       coalesce((select p.prosrc like '%not ryagram_private.footage_on()%' and p.prosrc like '%waiting >= 5%' and p.prosrc like '%today >= 20%' from pg_proc p where p.oid = to_regprocedure('public.connect_request_footage(text,text,text,text)')), false)
union all select 'both are still security definer with an empty search path, and belong to no API role or connector login',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_request_download(text,text,text,text)'), to_regprocedure('public.connect_request_footage(text,text,text,text)'))), false)
union all select 'ONLY the connector login can run both: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select bool_and(has_function_privilege('connect_runner', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('node_runner', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_request_download(text,text,text,text)'), to_regprocedure('public.connect_request_footage(text,text,text,text)'))), false)
union all select 'the plan tables are still closed to the connector login (it can only ask through the functions)',
       not has_table_privilege('connect_runner', 'public.download_plans', 'select,insert,update,delete')
       and not (to_regclass('public.footage_plans') is not null and has_table_privilege('connect_runner', 'public.footage_plans', 'select,insert,update,delete'));

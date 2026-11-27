-- AFTER 20261127000400_connect_compilation_status.sql (where a compilation stands, for the person's AI): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the rows answer false, never an error. Every column is named.
select 'connect_compilation_get(text, uuid) exists and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false) as ok
union all select 'it reads the token''s own person (connect_actor, scope read), takes no owner, and writes nothing',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''read'')%' and p.proargnames = array['p_token_hash', 'p_project']::text[]
                   and p.prosrc !~* '\m(insert|update|delete)\M'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'it is security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'ONLY the connector login can run it: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_compilation_get(text, uuid)', 'execute') and not has_function_privilege('anon', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_compilation_get(text, uuid)', 'execute') and not has_function_privilege('node_runner', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_compilation_get(text, uuid)') is not null), false)
union all select 'the request table is still closed to the connector login (it reads it only through this function)',
       not has_table_privilege('connect_runner', 'public.compilation_requests', 'select, insert, update, delete')
union all select 'IF compilation_runs exists, it has every column this function reads (project_id, request_sha256, state, matches, clips, film_seconds, error_code, created_at, updated_at); if the table does not exist yet this row is true and `run` is null',
       coalesce(to_regclass('public.compilation_runs') is null
                or (select count(*) = 9 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'compilation_runs'
                      and c.column_name in ('project_id', 'request_sha256', 'state', 'matches', 'clips', 'film_seconds', 'error_code', 'created_at', 'updated_at')), false)
union all select 'IF compilation_runs exists, the connector login cannot read it directly',
       coalesce(to_regclass('public.compilation_runs') is null or not has_table_privilege('connect_runner', 'public.compilation_runs', 'select, insert, update, delete'), false);

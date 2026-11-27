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
union all select 'IF compilation_runs exists, it has every column this function reads (id, owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code, started_at, updated_at, ended_at); if the table does not exist yet this row is true and `run` is null',
       coalesce(to_regclass('public.compilation_runs') is null
                or (select count(*) = 12 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'compilation_runs'
                      and c.column_name in ('project_id', 'request_sha256', 'state', 'matches', 'clips', 'film_seconds', 'error_code', 'started_at', 'updated_at', 'ended_at', 'id', 'owner_id')), false)
union all select 'IF compilation_runs exists, the connector login cannot read it directly',
       coalesce(to_regclass('public.compilation_runs') is null or not has_table_privilege('connect_runner', 'public.compilation_runs', 'select, insert, update, delete'), false)
union all select 'connect_set_compilation_request keeps its signature (text, uuid, jsonb) and answer (text), is security definer with an empty search path, and now asks the gate (connect_compilations_open) before anything else',
       coalesce((select pg_get_function_result(p.oid) = 'text' and p.prosecdef and p.prosrc like '%ryagram_private.connect_compilations_open(me)%' and p.prosrc like '%errcode = ''42501''%'
                   and p.prosrc like '%connect_actor(p_token_hash, ''write'')%' and p.prosrc like '%ryagram.compilation-request/0%' and p.prosrc like '%octet_length(p_request::text) > 32768%'
                   and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                 from pg_proc p where p.oid = to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)')), false)
union all select 'ONLY the connector login can still run connect_set_compilation_request (grants unchanged)',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_set_compilation_request(text, uuid, jsonb)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_set_compilation_request(text, uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'public.connect_set_compilation_request(text, uuid, jsonb)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_set_compilation_request(text, uuid, jsonb)', 'execute') and not has_function_privilege('node_runner', 'public.connect_set_compilation_request(text, uuid, jsonb)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)') is not null), false)
union all select 'the gate helper connect_compilations_open(uuid) exists and no API role, no connector login and nobody else can run it directly',
       coalesce(to_regprocedure('ryagram_private.connect_compilations_open(uuid)') is not null
                and not has_function_privilege('connect_runner', 'ryagram_private.connect_compilations_open(uuid)', 'execute') and not has_function_privilege('authenticated', 'ryagram_private.connect_compilations_open(uuid)', 'execute')
                and not has_function_privilege('anon', 'ryagram_private.connect_compilations_open(uuid)', 'execute') and not has_function_privilege('service_role', 'ryagram_private.connect_compilations_open(uuid)', 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('ryagram_private.connect_compilations_open(uuid)') and x.grantee = 0 and x.privilege_type = 'EXECUTE'), false);

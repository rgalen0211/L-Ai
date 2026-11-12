-- AFTER 20261112000100_connect_job_progress_detail.sql (the step words and the time left in the AI chat; launch slice IN 1, WORKER's row A10): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the row about the new key answers false, never an error. Every column is named.
select 'connect_job exists with its one signature (text, uuid) and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_job(text,uuid)')), false) as ok
union all select 'connect_job now returns the worker''s progress_detail',
       coalesce((select p.prosrc like '%''progress_detail'', j.progress_detail%' from pg_proc p where p.oid = to_regprocedure('public.connect_job(text,uuid)')), false)
union all select 'connect_job still reads only the token''s own account''s job (the owner check), with the read scope',
       coalesce((select p.prosrc like '%where id = p_job and owner_id = me%' and p.prosrc like '%connect_actor(p_token_hash, ''read'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_job(text,uuid)')), false)
union all select 'connect_job is still security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_job(text,uuid)')), false)
union all select 'ONLY the connector login can run connect_job: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_job(text,uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_job(text,uuid)', 'execute') and not has_function_privilege('anon', 'public.connect_job(text,uuid)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_job(text,uuid)', 'execute') and not has_function_privilege('node_runner', 'public.connect_job(text,uuid)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_job(text,uuid)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_job(text,uuid)') is not null), false)
union all select 'the field it reads is still held to the worker''s shape and size (the column check is in place)',
       exists (select 1 from pg_constraint c where c.conrelid = 'public.jobs'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%progress_detail%1024%');

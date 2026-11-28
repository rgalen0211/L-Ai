-- AFTER 20261128000200_connect_compilation_progress.sql (the three progress counts in connect_compilation_get, for the person's AI): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration, AFTER BUILDER's 20261128000100_compilation_progress.sql (the first row of the column check is false before his file; the other rows do not depend on it). Before the migration the rows answer false, never an error.
-- Step 66 (the check of 20261127000400) still passes after this migration: nothing it pins was removed.
select 'connect_compilation_get(text, uuid) still exists, returns jsonb, takes only a token hash and a project' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' and p.proargnames = array['p_token_hash', 'p_project']::text[]
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false) as ok
union all select 'BUILDER''s three columns exist on compilation_runs (step_done, step_total, percent), all integers (20261128000100); if this row is false the function answers null for all three',
       coalesce(to_regclass('public.compilation_runs') is not null
                and (select count(*) = 3 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'compilation_runs'
                       and c.column_name in ('step_done', 'step_total', 'percent') and c.data_type = 'integer'), false)
union all select 'it is still the token-checked read: connect_actor scope read, the gate connect_compilations_open, 42501 when closed, and no insert, update or delete',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''read'')%' and p.prosrc like '%ryagram_private.connect_compilations_open(me)%' and p.prosrc like '%errcode = ''42501''%'
                   and p.prosrc !~* '\m(insert|update|delete)\M'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'it is security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'ONLY the connector login can run it (grants unchanged): not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_compilation_get(text, uuid)', 'execute') and not has_function_privilege('anon', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_compilation_get(text, uuid)', 'execute') and not has_function_privilege('node_runner', 'public.connect_compilation_get(text, uuid)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_compilation_get(text, uuid)') is not null), false)
union all select 'the run carries the three keys (step_done, step_total, percent), read as keys of the row''s own jsonb so a missing column is a null, and always present in the answer',
       coalesce((select p.prosrc like '%to_jsonb(c) -> ''step_done''%' and p.prosrc like '%to_jsonb(c) -> ''step_total''%' and p.prosrc like '%to_jsonb(c) -> ''percent''%'
                   and p.prosrc like '%jsonb_build_object(''step_done'', sd, ''step_total'', st, ''percent'', pc)%'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'only a JSON number written as a whole number counts (text, a name, a path, 2.5, -3 are null), with the ranges: step_total 0 to 1000, step_done 0 to step_total only with a step_total, percent 0 to 100',
       coalesce((select p.prosrc like '%jsonb_typeof(prog -> ''step_total'') = ''number''%' and p.prosrc like '%jsonb_typeof(prog -> ''step_done'') = ''number''%' and p.prosrc like '%jsonb_typeof(prog -> ''percent'') = ''number''%'
                   and p.prosrc like '%st_text::int <= 1000 else%' and p.prosrc like '%sd_text::int <= st else%' and p.prosrc like '%pc_text::int <= 100 else%' and p.prosrc like '%''^[0-9]{1,4}$''%' and p.prosrc like '%''^[0-9]{1,3}$''%'
                   and p.prosrc like '%st is not null and sd_text%'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'the three are shown only while the run is planning, matching or building (an end state shows none)',
       coalesce((select p.prosrc like '%run ->> ''state'' in (''planning'', ''matching'', ''building'')%'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_compilation_get(text, uuid)')), false)
union all select 'the gate helper and the writer are untouched by this step: connect_compilations_open(uuid) exists and no API role can run it; connect_set_compilation_request keeps its gate',
       coalesce(to_regprocedure('ryagram_private.connect_compilations_open(uuid)') is not null
                and not has_function_privilege('connect_runner', 'ryagram_private.connect_compilations_open(uuid)', 'execute') and not has_function_privilege('authenticated', 'ryagram_private.connect_compilations_open(uuid)', 'execute')
                and (select p.prosrc like '%ryagram_private.connect_compilations_open(me)%' from pg_proc p where p.oid = to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)')), false);

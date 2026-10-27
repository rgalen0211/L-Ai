-- AFTER Q246 B (20261026000300_compilation_requests.sql): one SELECT, read-only. Every ok must be true.
select 'the compilation_requests table exists with row level security on' as check_name,
       to_regclass('public.compilation_requests') is not null
       and (select relrowsecurity from pg_class where oid = 'public.compilation_requests'::regclass) as ok
union all select 'a person can only READ their own rows: signed-in people have select and nothing else; the public, the service role and the connector have no direct access',
       has_table_privilege('authenticated', 'public.compilation_requests', 'select')
       and not has_table_privilege('authenticated', 'public.compilation_requests', 'insert,update,delete')
       and not has_table_privilege('anon', 'public.compilation_requests', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.compilation_requests', 'select,insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.compilation_requests', 'select,insert,update,delete')
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compilation_requests' and policyname = 'compilation_requests_owner_read')
union all select 'connect_set_compilation_request exists and ONLY the connector login can run it',
       to_regprocedure('public.connect_set_compilation_request(text,uuid,jsonb)') is not null
       and has_function_privilege('connect_runner', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'execute')
       and not has_function_privilege('service_role', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'execute')
union all select 'no request exists yet (nothing was saved by the migration)',
       (select count(*) from public.compilation_requests) = 0;

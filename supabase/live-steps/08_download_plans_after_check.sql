-- AFTER 20261027000500_download_plans.sql (download plans, NEXT-CONNECT 152): one SELECT, read-only. Every ok must be true.
select 'the table exists with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid = 'public.download_plans'::regclass and c.relrowsecurity) = 1 as ok
union all select 'the plans are untouchable directly (signed-in people may only READ their own; the public, the service role, the connector and the app login have no access)',
       has_table_privilege('authenticated', 'public.download_plans', 'select') and not has_table_privilege('authenticated', 'public.download_plans', 'insert,update,delete')
       and not has_table_privilege('anon', 'public.download_plans', 'select,insert,update,delete') and not has_table_privilege('service_role', 'public.download_plans', 'select,insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.download_plans', 'select,insert,update,delete') and not has_table_privilege('node_runner', 'public.download_plans', 'select,insert,update,delete')
union all select 'the two connector functions exist and ONLY the connector login can run them',
       (select count(*) from unnest(array['public.connect_request_download(text,text,text,text)', 'public.connect_list_downloads(text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 2
union all select 'the two desktop-app functions exist and ONLY the signed-in computer login can run them',
       (select count(*) from unnest(array['public.node_download_plans(text)', 'public.node_download_update(text,uuid,text,jsonb)']) f
         where to_regprocedure(f) is not null and has_function_privilege('node_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute')) = 2
union all select 'the consent page now offers the new scope "fetch_data" next to read, write, render_free and edit',
       ryagram_private.connect_offered_scopes() @> array['read', 'write', 'render_free', 'edit', 'fetch_data']
union all select 'no plan exists yet',
       (select count(*) from public.download_plans) = 0;

-- AFTER migration 20261026000500_app_downloads.sql: one SELECT, read-only, nothing is changed. Every row's ok must be true. Paste it into the SQL Editor of the live project.
select 'the two tables exist' as check_name,
       to_regclass('public.app_releases') is not null and to_regclass('public.app_downloads') is not null as ok
union all select 'nobody but the database owner can read them (not signed-in people, not the public, not the service role)',
       not has_table_privilege('authenticated', 'public.app_releases', 'select') and not has_table_privilege('authenticated', 'public.app_downloads', 'select')
       and not has_table_privilege('anon', 'public.app_releases', 'select') and not has_table_privilege('anon', 'public.app_downloads', 'select')
       and not has_table_privilege('service_role', 'public.app_releases', 'select') and not has_table_privilege('service_role', 'public.app_downloads', 'select')
union all select 'request_app_download exists and ONLY the service role can run it',
       to_regprocedure('public.request_app_download(uuid,text)') is not null
       and has_function_privilege('service_role', 'public.request_app_download(uuid,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.request_app_download(uuid,text)', 'execute')
       and not has_function_privilege('anon', 'public.request_app_download(uuid,text)', 'execute')
union all select 'my_app_downloads exists, signed-in people can run it, the public cannot',
       to_regprocedure('public.my_app_downloads()') is not null
       and has_function_privilege('authenticated', 'public.my_app_downloads()', 'execute')
       and not has_function_privilege('anon', 'public.my_app_downloads()', 'execute')
union all select 'at most one active release of each kind (the unique index is there)',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'app_releases_one_active')
union all select 'row level security is on for both tables',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('app_releases', 'app_downloads') and c.relrowsecurity) = 2;

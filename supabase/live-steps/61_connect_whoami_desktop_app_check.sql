-- BEFORE and AFTER 20261123000500_connect_whoami_desktop_app.sql (the connector tells an AI whether the account may have the desktop app): ONE read-only SELECT, changes nothing, never errors. Every column is named.
-- BEFORE the migration row 1 is FALSE and row 2 is true; AFTER it both are true.
select 'connect_whoami answers desktop_app, by the same rule as the app download (not a worker; an invited tester or an administrator)' as check_name,
       coalesce(pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%''desktop_app'', desk%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%s.local_compute%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.workers%', false) as ok
union all select 'connect_whoami is still for the connector login only (the connector may run it; a signed-in person, anonymous and the public may not)',
       coalesce(to_regprocedure('public.connect_whoami(text)') is not null
         and has_function_privilege('connect_runner', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_whoami(text)'), 'execute'), false);

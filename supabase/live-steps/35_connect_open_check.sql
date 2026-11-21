-- BEFORE and AFTER 20261121000100_connect_open_to_all.sql (Connect-an-AI opens to every signed-up account): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 36 (flag ON) the row "the flag is ..." says on and the rest stay true. Before the migration every row answers false, never an error.
select 'the flag exists' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all'), false) as ok
union all select 'the helper and the admin function exist',
       to_regprocedure('ryagram_private.connect_open()') is not null and to_regprocedure('public.admin_connect_set_open(boolean)') is not null
union all select 'nobody but an administrator session can flip it from the app: signed-in can run the function, anon and the public cannot, the connector login cannot, and the helper is closed to every API role',
       coalesce(to_regprocedure('public.admin_connect_set_open(boolean)') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and to_regprocedure('ryagram_private.connect_open()') is not null
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('ryagram_private.connect_open()'), 'execute'), false)
union all select 'the person rule still names an enabled list row, an administrator and a worker',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_access%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_open()%', false)
union all select 'the flag is ' || case when coalesce((select open_to_all from public.connect_flags where id), false) then 'ON: every signed-up account may connect an AI' else 'OFF: only the invited list (the state right after the migration)' end,
       (select count(*) = 1 from public.connect_flags where id);

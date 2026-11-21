-- BEFORE and AFTER 20261121000800_join_open.sql (sign-up open at launch): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 47 (flag ON) the last row says on and the rest stay true. Before the migration every row answers false, never an error.
select 'the flag exists, is not null and is on the one settings row' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'join_open' and is_nullable = 'NO'), false)
       and coalesce((select count(*) = 1 from public.ops_settings), false) as ok
union all select 'join_reserve asks the flag as well as the waiting switch, and is still for the service role only',
       coalesce(to_regprocedure('public.join_reserve(text,text)') is not null
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%join_open%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%waiting_on()%'
         and has_function_privilege('service_role', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.join_reserve(text,text)'), 'execute'), false)
union all select 'join_reserve still has the join limits and the turn-taking lock',
       coalesce(pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%pg_advisory_xact_lock%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%>= 200%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%>= 10%', false)
union all select 'nobody signed in or anonymous can read or write the settings row (the flag is the dashboards alone)',
       coalesce(not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'select')
         and not has_table_privilege('authenticated', 'public.ops_settings', 'update') and not has_table_privilege('service_role', 'public.ops_settings', 'update'), false)
union all select 'sign-up is ' || case when coalesce((select (to_jsonb(o) ->> 'join_open')::boolean from public.ops_settings o limit 1), false) then 'OPEN: a stranger who joins is '
                                       || case when coalesce((select (to_jsonb(o) ->> 'waiting_accounts')::boolean from public.ops_settings o limit 1), false) then 'put on the waiting list (the brake, step 20, is on)' else 'let in at once' end
                                  else 'CLOSED by this flag (the state right after the migration)' end,
       (select count(*) = 1 from public.ops_settings);

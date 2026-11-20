-- AFTER 20261120000500_prepared_data.sql (the AI hands Ryagram a table; the person accepts it in the app): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration every row answers false, never an error. Every column is named.
select 'the staging table exists and is closed to every API role (anon, signed-in, service, the connector login)' as check_name,
       coalesce(to_regclass('public.prepared_data') is not null
         and not (has_table_privilege('anon', 'public.prepared_data', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.prepared_data', 'select, insert, update, delete')
                  or has_table_privilege('service_role', 'public.prepared_data', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.prepared_data', 'select, insert, update, delete')), false) as ok
union all select 'datasets has the two new columns prepared_from and prep_log',
       (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name in ('prepared_from', 'prep_log'))
union all select 'the connector login (and only it) can hand a table over and list the person''s data',
       coalesce((select bool_and(has_function_privilege('connect_runner', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'))
                   and p.oid is not null) and (select count(*) = 2 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'))), false)
union all select 'the four app functions exist and are runnable by a signed-in session, not by anon or the public',
       coalesce((select count(*) = 4 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 'all six are security definer with an empty search path',
       coalesce((select count(*) = 6 and bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'), to_regprocedure('public.my_prepared_data()'),
                                                  to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 'the hand-over names the new scope submit_data and the signed-in functions name the signed-in person (no function takes an owner from the caller)',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''submit_data'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)')), false)
       and coalesce((select count(*) = 4 and bool_and(strpos(p.prosrc, 'require_signed_in()') > 0 and strpos(p.prosrc, 'p_owner') = 0)
                 from pg_proc p where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 'the signed-in functions carry the waiting-list check (the gate)',
       coalesce((select count(*) = 4 and bool_and(p.prosrc like '%require_active%') from pg_proc p
                 where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 'the consent page now offers submit_data, and the five scopes that were there are still offered',
       coalesce(ryagram_private.connect_offered_scopes() @> array['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data']::text[], false);

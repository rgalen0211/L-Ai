-- AFTER 20261119000100_film_card_failed_age.sql (the card read also says how many seconds ago a failed picture failed): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first two rows answer false, never an error. Every column is named.
select 'connect_film_card_get names failed_s for a failed request (the newest picture)' as check_name,
       coalesce((select p.prosrc like '%''fail_detail'', r.fail_detail, ''retry'', retry, ''failed_s'', case when r.state = ''failed'' then%' from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false) as ok
union all select 'and for a failed refresh under an older picture',
       coalesce((select p.prosrc like '%''retry'', retry, ''failed_s'', case when r.state = ''failed'' then%end)%' from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false)
union all select 'connect_film_card_get still carries the retry rule (engine_error, older than 10 minutes)',
       coalesce((select p.prosrc like '%r.fail_code = ''engine_error'' and r.finished_at < now() - interval ''10 minutes''%' from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false)
union all select 'connect_film_card_get still checks the connector token (connect_actor)',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''read'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false)
union all select 'connect_film_card_get is still security definer with an empty search path',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false)
union all select 'connect_film_card_get is still runnable by the connector role only (not by anon, signed-in sessions or the public)',
       coalesce((select has_function_privilege('connect_runner', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_film_card_get(text,uuid)')), false)
union all select 'the film card table is still closed to every API role',
       not (has_table_privilege('anon', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.film_card_requests', 'select, insert, update, delete')
            or has_table_privilege('service_role', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.film_card_requests', 'select, insert, update, delete'));

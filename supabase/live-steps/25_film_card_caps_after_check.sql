-- AFTER 20261113000100_film_card_caps.sql (the film card caps: a picture of 300000 characters, a card of 320000 bytes, the newest 20 cards kept per person): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first three rows answer false, never an error. Every column is named.
select 'the stored answer may be up to 320000 bytes (the column check)' as check_name,
       exists (select 1 from pg_constraint c where c.conrelid = 'public.film_card_requests'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%octet_length%answer%<= 320000%') as ok
union all select 'and no older 262144 check is left on that column',
       not exists (select 1 from pg_constraint c where c.conrelid = 'public.film_card_requests'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%262144%')
union all select 'finish_film_card refuses a card over 320000 bytes (and no longer 262144)',
       coalesce((select p.prosrc like '%octet_length(p_card::text) > 320000%' and p.prosrc not like '%262144%' from pg_proc p where p.oid = to_regprocedure('public.finish_film_card(uuid,jsonb)')), false)
union all select 'finish_film_card keeps only the newest 20 answered cards of the same person',
       coalesce((select p.prosrc like '%where owner_id = g.owner_id and state = ''answered'' order by finished_at desc limit 20%' from pg_proc p where p.oid = to_regprocedure('public.finish_film_card(uuid,jsonb)')), false)
union all select 'finish_film_card still carries the waiting-list check (the gate)',
       coalesce((select p.prosrc like '%require_active%' from pg_proc p where p.oid = to_regprocedure('public.finish_film_card(uuid,jsonb)')), false)
union all select 'finish_film_card is still security definer with an empty search path',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) from pg_proc p where p.oid = to_regprocedure('public.finish_film_card(uuid,jsonb)')), false)
union all select 'finish_film_card is still runnable by a signed-in session (the worker, checked inside) and not by the public or anon',
       coalesce((select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.finish_film_card(uuid,jsonb)')), false)
union all select 'the film card table is still closed to every API role',
       not (has_table_privilege('anon', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.film_card_requests', 'select, insert, update, delete')
            or has_table_privilege('service_role', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.film_card_requests', 'select, insert, update, delete'));

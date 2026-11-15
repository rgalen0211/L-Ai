-- AFTER 20261113000500_my_film_cards.sql (the site's own film look card: my_film_card_ask and my_film_card_get): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration every FUNCTION row answers false, never an error (the last row, that the film card table is closed to every API role, answers true before and after). Every column is named.
select 'my_film_card_ask(uuid) exists' as check_name,
       to_regprocedure('public.my_film_card_ask(uuid)') is not null as ok
union all select 'my_film_card_get(uuid) exists',
       to_regprocedure('public.my_film_card_get(uuid)') is not null
union all select 'both are runnable by a signed-in session and not by anon or the public',
       coalesce((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.my_film_card_ask(uuid)'), to_regprocedure('public.my_film_card_get(uuid)'))), false)
union all select 'both are security definer with an empty search path',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.my_film_card_ask(uuid)'), to_regprocedure('public.my_film_card_get(uuid)'))), false)
union all select 'both name the signed-in person (require_signed_in) and take no owner from the caller',
       coalesce((select bool_and(strpos(p.prosrc, 'require_signed_in()') > 0 and strpos(p.prosrc, 'p_owner') = 0 and strpos(p.prosrc, 'p_user') = 0) from pg_proc p
                 where p.oid in (to_regprocedure('public.my_film_card_ask(uuid)'), to_regprocedure('public.my_film_card_get(uuid)'))), false)
union all select 'both carry the waiting-list check (the gate)',
       coalesce((select bool_and(p.prosrc like '%require_active%') from pg_proc p
                 where p.oid in (to_regprocedure('public.my_film_card_ask(uuid)'), to_regprocedure('public.my_film_card_get(uuid)'))), false)
union all select 'the ask takes the same lock as the connector''s ask',
       coalesce((select p.prosrc like '%pg_advisory_xact_lock(hashtextextended(''film_card:'' || me::text, 0))%' and q.prosrc like '%pg_advisory_xact_lock(hashtextextended(''film_card:'' || me::text, 0))%'
                 from pg_proc p, pg_proc q where p.oid = to_regprocedure('public.my_film_card_ask(uuid)') and q.oid = to_regprocedure('public.connect_film_card_ask(text,uuid)')), false)
union all select 'the film card table is still closed to every API role',
       not (has_table_privilege('anon', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.film_card_requests', 'select, insert, update, delete')
            or has_table_privilege('service_role', 'public.film_card_requests', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.film_card_requests', 'select, insert, update, delete'));

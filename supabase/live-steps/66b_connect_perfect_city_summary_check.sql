-- AFTER 20261127000500_connect_perfect_city_summary.sql (the Perfect City numbers for a spot, for the person's AI): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the rows answer false, never an error. Every column is named.
select 'connect_perfect_city_summary(text, text, text, double precision, double precision) exists and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_perfect_city_summary(text, text, text, double precision, double precision)')), false) as ok
union all select 'it reads the token''s own person (connect_actor, scope read), takes no owner, passes that person to GEO''s helper, and writes nothing',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''read'')%' and p.prosrc like '%perfect_city_summary_for%'
                   and p.proargnames = array['p_token_hash', 'p_county', 'p_kind', 'p_lat', 'p_lon']::text[]
                   and p.prosrc !~* '\m(insert|update|delete)\M'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_perfect_city_summary(text, text, text, double precision, double precision)')), false)
union all select 'it is security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_perfect_city_summary(text, text, text, double precision, double precision)')), false)
union all select 'ONLY the connector login can run it: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select has_function_privilege('connect_runner', 'public.connect_perfect_city_summary(text, text, text, double precision, double precision)', 'execute')
                   and not has_function_privilege('authenticated', 'public.connect_perfect_city_summary(text, text, text, double precision, double precision)', 'execute')
                   and not has_function_privilege('anon', 'public.connect_perfect_city_summary(text, text, text, double precision, double precision)', 'execute')
                   and not has_function_privilege('service_role', 'public.connect_perfect_city_summary(text, text, text, double precision, double precision)', 'execute')
                   and not has_function_privilege('node_runner', 'public.connect_perfect_city_summary(text, text, text, double precision, double precision)', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                    where p.oid = to_regprocedure('public.connect_perfect_city_summary(text, text, text, double precision, double precision)') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_perfect_city_summary(text, text, text, double precision, double precision)') is not null), false)
union all select 'IF GEO''s helper exists, the connector login cannot run it directly (only through this function); if it does not exist yet this row is true and the call says Perfect City is not available yet',
       coalesce(to_regprocedure('ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)') is null
                or (not has_function_privilege('connect_runner', 'ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)', 'execute')
                    and not has_function_privilege('authenticated', 'ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)', 'execute')
                    and not has_function_privilege('anon', 'ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)', 'execute')), false);

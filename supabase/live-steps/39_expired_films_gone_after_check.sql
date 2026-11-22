-- AFTER 20261121000200_expired_films_really_gone.sql (an expired paid film is marked deleted only once its file is really gone; GEO's privacy review M2): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first three rows answer false, never an error. Every column is named.
select 'render_orders_tick no longer marks a delivery deleted (it lists due_deliveries instead)' as check_name,
       coalesce((select p.prosrc like '%''due_deliveries''%' and p.prosrc not like '%update public.render_deliveries set deleted_at%'
                 from pg_proc p where p.oid = to_regprocedure('public.render_orders_tick()')), false) as ok
union all select 'mark_deliveries_removed exists and checks storage.objects in the ryagram-artifacts bucket',
       coalesce((select p.prosrc like '%storage.objects o where o.bucket_id = ''ryagram-artifacts''%'
                 from pg_proc p where p.oid = to_regprocedure('public.mark_deliveries_removed(uuid[])')), false)
union all select 'mark_deliveries_removed never marks a film inside its 30 days (expires_at < now())',
       coalesce((select p.prosrc like '%r.expires_at < now()%' from pg_proc p where p.oid = to_regprocedure('public.mark_deliveries_removed(uuid[])')), false)
union all select 'both are security definer with an empty search path',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.render_orders_tick()'), to_regprocedure('public.mark_deliveries_removed(uuid[])'))), false)
union all select 'both are runnable by the service role only (not by anon, signed-in sessions or the public)',
       coalesce((select bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                                 and not has_function_privilege('authenticated', p.oid, 'execute')
                                 and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.render_orders_tick()'), to_regprocedure('public.mark_deliveries_removed(uuid[])'))), false)
union all select 'the customer still cannot reach an expired film (delivery_object refuses past expires_at)',
       coalesce((select p.prosrc like '%d.deleted_at is not null or d.expires_at < now()%' from pg_proc p where p.oid = to_regprocedure('ryagram_private.delivery_object(uuid,uuid)')), false);

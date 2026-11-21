-- AFTER 20261121000300_upload_films_gone.sql (films made FROM a customer's upload go when the upload goes; GEO's privacy review M3): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first two rows answer false, never an error. Every column is named.
select 'upload_films_due_for_deletion exists and lists only films of REMOVED uploads' as check_name,
       coalesce((select p.prosrc like '%d.source = ''upload'' and d.deleted_at is not null%'
                 from pg_proc p where p.oid = to_regprocedure('public.upload_films_due_for_deletion(integer)')), false) as ok
union all select 'mark_upload_films_removed exists and checks storage.objects in the ryagram-artifacts bucket',
       coalesce((select p.prosrc like '%storage.objects o where o.bucket_id = ''ryagram-artifacts''%'
                 from pg_proc p where p.oid = to_regprocedure('public.mark_upload_films_removed(uuid[])')), false)
union all select 'the rule: a paid final film stays under Don''t keep (it goes only when the person deleted the data)',
       coalesce((select p.prosrc like '%d.delete_requested_at is not null or d.trashed_at is not null%j.job_type <> ''final_render''%'
                 from pg_proc p where p.oid = to_regprocedure('public.upload_films_due_for_deletion(integer)')), false)
union all select 'both are security definer with an empty search path',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.upload_films_due_for_deletion(integer)'), to_regprocedure('public.mark_upload_films_removed(uuid[])'))), false)
union all select 'both are runnable by the service role only (not by anon, signed-in sessions or the public)',
       coalesce((select bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                                 and not has_function_privilege('authenticated', p.oid, 'execute')
                                 and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.upload_films_due_for_deletion(integer)'), to_regprocedure('public.mark_upload_films_removed(uuid[])'))), false);

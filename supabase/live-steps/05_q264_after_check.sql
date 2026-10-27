-- AFTER Q264 B (20261027000200_uploads_recently_deleted.sql, AFTER Q239 B and Q263 B): one SELECT, read-only. Every ok must be true.
select 'datasets has trashed_at and its index' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name = 'trashed_at')
       and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'datasets_trashed_at_idx') as ok
union all select 'nothing was moved to Recently deleted by the migration itself',
       not exists (select 1 from public.datasets where trashed_at is not null)
union all select 'restore_dataset, delete_dataset_forever and my_recently_deleted_uploads exist for signed-in people, not for the public',
       (select count(*) from unnest(array['public.restore_dataset(uuid)', 'public.delete_dataset_forever(uuid)', 'public.my_recently_deleted_uploads()']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 3
union all select 'uploads_due_for_deletion is the service role''s alone',
       to_regprocedure('public.uploads_due_for_deletion(integer)') is not null
       and has_function_privilege('service_role', 'public.uploads_due_for_deletion(integer)', 'execute')
       and not has_function_privilege('authenticated', 'public.uploads_due_for_deletion(integer)', 'execute')
       and not has_function_privilege('anon', 'public.uploads_due_for_deletion(integer)', 'execute')
union all select 'THE TICK AND THE LABEL ARE KEPT: confirm_dataset_mapping exists once, still demands the tick, and now also refuses a trashed upload',
       (select count(*) from pg_proc where proname = 'confirm_dataset_mapping' and pronamespace = 'public'::regnamespace) = 1
       and (select pg_get_functiondef(p.oid) like '%Tick the box to use this data anyway%' and pg_get_functiondef(p.oid) like '%trashed_at is null%'
            from pg_proc p where p.proname = 'confirm_dataset_mapping' and p.pronamespace = 'public'::regnamespace)
union all select 'attach_upload_to_version still writes the film source row with its trust label, and refuses a trashed upload',
       (select pg_get_functiondef(p.oid) like '%trust_label%' and pg_get_functiondef(p.oid) like '%trashed_at is null%'
        from pg_proc p where p.proname = 'attach_upload_to_version' and p.pronamespace = 'public'::regnamespace)
union all select 'the job claim still carries the label (Q239 B is not undone)',
       (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_next_job', 'node_claim') and pg_get_functiondef(p.oid) like '%upload_trust_for%') = 2;

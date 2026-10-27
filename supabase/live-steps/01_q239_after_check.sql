-- AFTER Q239 B (20261026000100 then 20261026000200): one SELECT, read-only. Every ok must be true. Run it RIGHT AFTER these two files (before the later steps add fetched files; its row 2 is about the files that exist today).
select 'datasets has trust_label (default unverified_user) and trust_ack_at' as check_name,
       (select column_default like '%unverified_user%' from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name = 'trust_label')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name = 'trust_ack_at') as ok
union all select 'every upload that exists is unverified, and none is approved without the moment of the tick',
       not exists (select 1 from public.datasets where source = 'upload' and (trust_label <> 'unverified_user' or (status = 'approved' and trust_ack_at is null)))
union all select 'a film source row has trust_label, and every upload source row says unverified_user',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'version_sources' and column_name = 'trust_label')
       and not exists (select 1 from public.version_sources where kind = 'upload' and trust_label is distinct from 'unverified_user')
union all select 'the three label rules are in place',
       (select count(*) from pg_constraint where conname in ('datasets_upload_label_is_unverified', 'datasets_approved_upload_was_acknowledged', 'version_sources_upload_label_is_unverified')) = 3
union all select 'confirm_dataset_mapping exists ONCE, with the tick argument; signed-in people can run it and the public cannot',
       (select count(*) from pg_proc where proname = 'confirm_dataset_mapping' and pronamespace = 'public'::regnamespace) = 1
       and to_regprocedure('public.confirm_dataset_mapping(uuid,jsonb,boolean)') is not null
       and has_function_privilege('authenticated', 'public.confirm_dataset_mapping(uuid,jsonb,boolean)', 'execute')
       and not has_function_privilege('anon', 'public.confirm_dataset_mapping(uuid,jsonb,boolean)', 'execute')
union all select 'jobs.upload_trust exists; the helper upload_trust_for exists and nobody (not signed-in people, not the public, not the service role) can run it',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'upload_trust')
       and to_regprocedure('ryagram_private.upload_trust_for(uuid,jsonb)') is not null
       and not has_function_privilege('authenticated', 'ryagram_private.upload_trust_for(uuid,jsonb)', 'execute')
       and not has_function_privilege('anon', 'ryagram_private.upload_trust_for(uuid,jsonb)', 'execute')
       and not has_function_privilege('service_role', 'ryagram_private.upload_trust_for(uuid,jsonb)', 'execute')
union all select 'both job claims (house and node) carry the label',
       (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_next_job', 'node_claim') and pg_get_functiondef(p.oid) like '%upload_trust_for%') = 2;

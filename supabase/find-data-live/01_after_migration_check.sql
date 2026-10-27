-- AFTER migration 20261027000100_find_data_fetch.sql (find-data S1): one SELECT, read-only, nothing is changed. Every row's ok must be true. Paste it into the SQL Editor of the live project.
select 'the host list exists with its sixteen starting hosts, all Official, none with a licence class yet' as check_name,
       to_regclass('public.fetch_hosts') is not null
       and (select count(*) from public.fetch_hosts) >= 16
       and not exists (select 1 from public.fetch_hosts where label <> 'official' or licence_class <> 'unknown') as ok
union all select 'the host list and the attempts are readable by nobody (not signed-in people, not the public, not the service role)',
       not has_table_privilege('authenticated', 'public.fetch_hosts', 'select') and not has_table_privilege('anon', 'public.fetch_hosts', 'select') and not has_table_privilege('service_role', 'public.fetch_hosts', 'select')
       and not has_table_privilege('authenticated', 'public.fetch_attempts', 'select') and not has_table_privilege('anon', 'public.fetch_attempts', 'select') and not has_table_privilege('service_role', 'public.fetch_attempts', 'select')
union all select 'the receipt table can be READ by its owner and written by nobody',
       has_table_privilege('authenticated', 'public.dataset_fetches', 'select') and not has_table_privilege('anon', 'public.dataset_fetches', 'select')
       and not has_table_privilege('authenticated', 'public.dataset_fetches', 'insert,update,delete') and not has_table_privilege('service_role', 'public.dataset_fetches', 'insert,update,delete')
union all select 'row level security is on for the three new tables',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('fetch_hosts', 'fetch_attempts', 'dataset_fetches') and c.relrowsecurity) = 3
union all select 'the six fetch functions exist and ONLY the service role can run them',
       (select count(*) from unnest(array['public.fetch_host_for(text)', 'public.fetch_reserve(uuid,text)', 'public.fetch_fail(uuid,text)',
                                          'public.fetch_register(uuid,uuid,text,text,bigint,text,text,text,text,text)', 'public.fetch_finish(uuid)', 'public.fetch_abort(uuid)']) f
         where to_regprocedure(f) is not null and has_function_privilege('service_role', f, 'execute')
           and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 6
union all select 'fetch_register takes no label: none of its inputs is named for one',
       not exists (select 1 from pg_proc p, unnest(p.proargnames) n where p.proname = 'fetch_register' and n like 'p\_%' and (n like '%label%' or n like '%trust%' or n like '%official%' or n like '%licence_class%'))
union all select 'every dataset that existed before is still an ordinary upload: origin uploaded, no licence class, not publishable',
       not exists (select 1 from public.datasets where origin <> 'uploaded' and not exists (select 1 from public.dataset_fetches f where f.dataset_id = datasets.id))
       and not exists (select 1 from public.datasets where origin = 'uploaded' and (licence_class is not null or publishable))
union all select 'the label rules are in place (uploaded = unverified, fetched = labelled, publishable = Official + open, a fetched dataset has its receipt)',
       (select count(*) from pg_constraint where conrelid = 'public.datasets'::regclass and conname in
          ('datasets_uploaded_label_is_unverified', 'datasets_fetched_is_a_labelled_upload', 'datasets_uploaded_has_no_licence_class', 'datasets_publishable_means_official_and_open')) = 4
       and exists (select 1 from pg_trigger where tgname = 'datasets_fetched_needs_receipt' and tgrelid = 'public.datasets'::regclass)
union all select 'a film source row can only be fetched if it is an upload row, and an upload row is unverified unless fetched',
       (select count(*) from pg_constraint where conrelid = 'public.version_sources'::regclass and conname in ('version_sources_upload_label_rule', 'version_sources_only_uploads_are_fetched')) = 2
union all select 'confirm_dataset_mapping has exactly one version (three arguments), signed-in people can run it and the public cannot',
       (select count(*) from pg_proc where proname = 'confirm_dataset_mapping' and pronamespace = 'public'::regnamespace) = 1
       and has_function_privilege('authenticated', 'public.confirm_dataset_mapping(uuid,jsonb,boolean)', 'execute') and not has_function_privilege('anon', 'public.confirm_dataset_mapping(uuid,jsonb,boolean)', 'execute')
union all select 'attach_upload_to_version is still callable by signed-in people only',
       has_function_privilege('authenticated', 'public.attach_upload_to_version(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.attach_upload_to_version(uuid,uuid)', 'execute');

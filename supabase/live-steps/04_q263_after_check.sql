-- AFTER Q263 B (20261004000500_worker_job_upload.sql, then 20261004000510_worker_read_policy_follow_up.sql, run BY HAND in this order): one SELECT, read-only. Every ok must be true.
select 'worker_job_upload exists; signed-in logins can call it (the function itself lets only the enabled worker holding the job through) and the public cannot' as check_name,
       to_regprocedure('public.worker_job_upload(uuid)') is not null
       and has_function_privilege('authenticated', 'public.worker_job_upload(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.worker_job_upload(uuid)', 'execute') as ok
union all select 'the worker read rule is the follow-up one: a job of the file owner, a CONFIRMED upload, no deletion requested',
       (select pg_get_functiondef(p.oid) like '%j.owner_id = d.owner_id%' and pg_get_functiondef(p.oid) like '%delete_requested_at%'
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'ryagram_private' and p.proname = 'worker_may_read_upload')
union all select 'the storage rule that uses it is still attached ("Worker reads the uploads it is working on")',
       exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Worker reads the uploads it is working on')
union all select 'the read rule is not open to the public or signed-in people as a function (only the policy uses it)',
       not has_function_privilege('anon', 'ryagram_private.worker_may_read_upload(text)', 'execute');

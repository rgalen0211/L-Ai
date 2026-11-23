-- AFTER live-steps/55 (CONNECT 2026-11-23): READ-ONLY, one SELECT, changes nothing, never prints a secret. Every column is named.
-- Row 6 looks ONLY at the calls to the two purge functions (GAMES 09:15: the other jobs, ops-tick above all, call every minute and must not hide a failing purge or fail this check): it joins pg_net's reply table to net.http_request_queue, where the ops section of supabase/README.md (Q91) says this project keeps every scheduled call with its url.
-- Run it twice: right after 55 (rows 1 to 4 must be true; rows 5 and 6 say 'not run yet' and are false: that is expected), and again a few minutes PAST the next :30 (all six true).
select 'both jobs are scheduled and active, at :00 and :30 every hour' as check_name,
       coalesce((select count(*) = 2 from cron.job j where j.active and ((j.jobname = 'purge-uploads' and j.schedule = '0 * * * *') or (j.jobname = 'purge-partial-uploads' and j.schedule = '30 * * * *'))), false) as ok
union all select 'each job calls its own function with its own Vault secret, not the service-role key',
       coalesce((select bool_and(j.command like '%/functions/v1/' || j.jobname || '''%' and j.command not like '%service_role_key%'
                                 and j.command like '%name = ''' || case j.jobname when 'purge-uploads' then 'cron_purge_uploads' else 'cron_purge_partial' end || '''%')
                   from cron.job j where j.jobname in ('purge-uploads', 'purge-partial-uploads')), false)
union all select 'no job in the project reads the service-role key from the Vault',
       coalesce((select not bool_or(j.command like '%service_role_key%') from cron.job j), true)
union all select 'all six jobs are there: connect-purge, cost-sync, ops-digest, ops-tick, purge-partial-uploads, purge-uploads',
       coalesce((select count(*) = 6 from cron.job j where j.jobname in ('connect-purge', 'cost-sync', 'ops-digest', 'ops-tick', 'purge-partial-uploads', 'purge-uploads')), false)
union all select 'each purge job has run at least once and its last run succeeded',
       coalesce((select count(*) = 2 from cron.job j where j.jobname in ('purge-uploads', 'purge-partial-uploads')
                   and (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) = 'succeeded'), false)
union all select 'every call to a PURGE function in the last 2 hours answered 200 (a 403 means the Vault value and the function secret differ, a 500 means the sweep failed), and at least one did',
       coalesce((select count(*) filter (where r.status_code is distinct from 200) = 0 and count(*) filter (where r.status_code = 200) >= 1
                   from net._http_response r join net.http_request_queue q on q.id = r.id
                  where q.url like '%/functions/v1/purge-%' and r.created > now() - interval '2 hours'), false);

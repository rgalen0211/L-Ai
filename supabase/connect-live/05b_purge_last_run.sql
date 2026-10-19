-- READ-ONLY. When did the daily connector purge (select public.connect_purge();) last run, and did it succeed? Needs the pg_cron extension
-- (Dashboard, Integrations, Cron). If pg_cron is not installed this fails with 'relation cron.job does not exist': that itself is the answer, the purge
-- cannot be scheduled yet. Every column is named. status: ok = a success within 36 hours; act = no success in 36 hours; look = the job is not scheduled or has never run.
select j.jobid as job_id, j.schedule as schedule, last_ok.at as last_success_at, last_any.status as last_run_status, last_any.at as last_run_at,
       case when last_ok.at is not null and last_ok.at > now() - interval '36 hours' then 'ok'
            when last_any.at is null then 'look' else 'act' end as status,
       case when last_ok.at is not null and last_ok.at > now() - interval '36 hours' then 'Nothing to do.'
            when last_any.at is null then 'Scheduled but has not run yet. Wait for the first run, or run select public.connect_purge(); once by hand.'
            else 'No success in 36 hours. Open this job in Dashboard, Integrations, Cron, Run history for the error; run select public.connect_purge(); once by hand.' end as what_to_do
  from cron.job j
  left join lateral (select max(d.start_time) as at from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded') last_ok on true
  left join lateral (select d.start_time as at, d.status as status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) last_any on true
 where j.command ilike '%connect_purge%'
union all
select null::bigint, null::text, null::timestamptz, null::text, null::timestamptz, 'look',
       'No cron job runs public.connect_purge(). Dashboard, Integrations, Cron: schedule select public.connect_purge(); once a day.'
 where not exists (select 1 from cron.job where command ilike '%connect_purge%')
order by 6;

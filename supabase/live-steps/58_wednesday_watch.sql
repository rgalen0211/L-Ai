-- WEDNESDAY WATCH (Ryan's look, read-only, any time; Wednesday from 10:00 once an hour until 22:30; CC1 10:05): one SELECT, one labelled row each, changes nothing.
-- Run it in the SQL Editor (paste all, Run). Read each row's 'value' against its 'tell_cc1_if'. Nothing here changes a setting; every fix is a numbered live step CC1 names.
-- Also keep the site's #/admin/ops page open all day, and look at Supabase, Edge Functions, ops-tick, Invocations now and then: it should show a 200 every minute.
-- Rows: jobs waiting now and the oldest wait; sign-ups in the last hour; sign-ups not opened 20 minutes after; failed or needs-decision jobs in the last hour by code;
-- the sign-up size used (different addresses in the last 24 hours, the same count join uses, CONNECT d028a68d) against join_daily_max; then one row per scheduled job: its last run.
select what, value, tell_cc1_if from (
select 1 as n, 'jobs waiting now' as what,
       (select count(*) from public.jobs where state = 'queued')::text || ' waiting; oldest '
         || coalesce((select round(extract(epoch from now() - min(queued_at)) / 60)::text from public.jobs where state = 'queued'), '0') || ' min' as value,
       'the oldest is over 30 min' as tell_cc1_if
union all
select 2, 'sign-ups in the last hour',
       (select count(*) from auth.users where created_at > now() - interval '1 hour')::text,
       'it is 0 for two hours in a row while people say they tried (the join email may be failing)'
union all
select 3, 'sign-ups not opened 20 minutes after (made 20 to 60 min ago)',
       (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes' and email_confirmed_at is null)::text
         || ' of ' || (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes')::text,
       'more than half are not opened: the emails may not be arriving (Edge Functions, join, Logs: look for lines starting join invite:)'
union all
select 4, 'failed or needs-decision jobs in the last hour, by code',
       coalesce((select string_agg(code || ' x' || n, ', ' order by n desc, code)
                   from (select coalesce(error_code, 'no_code') as code, count(*) as n from public.jobs
                          where state in ('failed', 'editorial_action_required') and ended_at > now() - interval '1 hour' group by 1) f), 'none'),
       'any one code 3 or more times, or any of crash, start_failed, no_receipt, no_output, no_commit, worker_error, upload_failed, straggler (the machine's faults, as WORKER's watch lists them)'
union all
select 5, 'sign-up size used (different addresses, last 24 hours)',
       (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day')::text
         || ' of ' || coalesce((select (to_jsonb(o) ->> 'join_daily_max') from public.ops_settings o limit 1), '200 (no setting)'),
       'it is within 10 of the size: decide with CC1 whether to raise it (live step 52)'
union all
  select 6, 'scheduled job ' || j.jobname,
         coalesce(r.status || ' ' || round(extract(epoch from now() - r.start_time) / 60)::text || ' min ago', 'never ran')
           || case when j.active then '' else ' (NOT ACTIVE)' end,
         'its status is not succeeded, it is NOT ACTIVE, or ops-tick last ran more than 3 minutes ago'
    from cron.job j
    left join lateral (select d.status, d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
) watch
order by n, what;

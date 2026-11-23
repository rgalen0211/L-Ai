-- WEDNESDAY WATCH (Ryan's look, read-only, any time; Wednesday from 10:00 once an hour until 22:30; CC1 10:05): one SELECT, one labelled row each, changes nothing.
-- Run it in the SQL Editor (paste all, Run). Read each row's 'value' against its 'tell_cc1_if'. Nothing here changes a setting; every fix is a numbered live step CC1 names.
-- Also keep the site's #/admin/ops page open all day, and look at Supabase, Edge Functions, ops-tick, Invocations now and then: it should show a 200 every minute
-- (a scheduled job's 'succeeded' below only means its call was QUEUED; the 'calls answered with an error' row and the Invocations page are what prove a function answered).
-- Rows: render-PC jobs waiting now and the oldest; jobs claimed but not started after 10 minutes; the render PC's last check-in; sign-ups in the last hour; sign-ups
-- not opened 20 minutes after; failed or needs-decision jobs in the last hour by code; the sign-up size used (different addresses in 24 hours, as join counts, CONNECT
-- d028a68d) against join_daily_max; scheduled calls answered with an error in the last hour; then one row per scheduled job: its last run.
select what, value, tell_cc1_if from (
select 1 as n, 'jobs waiting now for the render PC' as what,
       (select count(*) from public.jobs where state = 'queued' and run_on = 'house')::text || ' waiting; oldest made '
         || coalesce((select round(extract(epoch from now() - min(created_at)) / 60)::text from public.jobs where state = 'queued' and run_on = 'house'), '0') || ' min ago' as value,
       'the oldest is over 30 min' as tell_cc1_if
union all
select 2, 'jobs claimed by the render PC but not started after 10 minutes',
       (select count(*) from public.jobs where state = 'claimed' and run_on = 'house' and claimed_at < now() - interval '10 minutes')::text,
       'it is 1 or more'
union all
select 3, 'render PC last checked in',
       coalesce((select round(extract(epoch from now() - max(last_seen_at)) / 60)::text || ' min ago' from public.workers where enabled and last_seen_at is not null), 'never'),
       'it is over 5 min ago, or never'
union all
select 4, 'sign-ups in the last hour',
       (select count(*) from auth.users where created_at > now() - interval '1 hour')::text,
       'it is 0 for two hours in a row while people say they tried (the join email may be failing)'
union all
select 5, 'sign-ups not opened 20 minutes after (made 20 to 60 min ago)',
       (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes' and email_confirmed_at is null)::text
         || ' of ' || (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes')::text,
       'more than half are not opened: the emails may not be arriving (Edge Functions, join, Logs: look for lines starting join invite:)'
union all
select 6, 'failed or needs-decision jobs in the last hour, by code',
       coalesce((select string_agg(code || ' x' || n, ', ' order by n desc, code)
                   from (select coalesce(error_code, 'no_code') as code, count(*) as n from public.jobs
                          where state in ('failed', 'editorial_action_required') and ended_at > now() - interval '1 hour' group by 1) f), 'none'),
       'any one code 3 or more times, or any of queue_timeout (the render PC is off), engine_unsupported (a blocked film got through), limit_exceeded, crash, start_failed, no_receipt, no_output, no_commit, worker_error, upload_failed, straggler'
union all
select 7, 'sign-up size used (different addresses, last 24 hours)',
       (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day')::text
         || ' of ' || coalesce((select (to_jsonb(o) ->> 'join_daily_max') from public.ops_settings o limit 1), '200 (no setting)'),
       'it is within 10 of the size: decide with CC1 whether to raise it (live step 52)'
union all
select 8, 'scheduled calls answered with an error in the last hour',
       (select count(*) filter (where status_code is null or status_code not between 200 and 299) from net._http_response where created > now() - interval '1 hour')::text
         || ' of ' || (select count(*) from net._http_response where created > now() - interval '1 hour')::text,
       'it is 1 or more'
union all
select 9, 'scheduled job ' || j.jobname,
       coalesce(r.status || ' ' || round(extract(epoch from now() - r.start_time) / 60)::text || ' min ago', 'never ran')
         || case when j.active then '' else ' (NOT ACTIVE)' end,
       'its status is failed (running or starting just means it is on now), it is NOT ACTIVE, or ops-tick last ran more than 3 minutes ago'
  from cron.job j
  left join lateral (select d.status, d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
) watch
order by n, what;

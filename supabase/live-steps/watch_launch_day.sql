-- LAUNCH-DAY WATCH, ONE PASTE (GEO, Wed 11-25; Claude 08:05 wave 2 D, CC1 09:05). Read-only: ONE select, changes nothing. Live steps 58 and 65 in one,
-- plus the email budget and the made-up-address flood. Once an hour from the opening until 22:30: paste ALL into the SQL Editor, Run.
-- Read the FIRST row: 'OK: nothing to do' or 'LOOK: rows ...'. For each row marked LOOK, do what its 'what_you_do' says. Never change a setting
-- on your own except the two levers named here (step 48 closes sign-up, step 71 brakes the queue); everything else: tell CC1.
-- AFTER A WELCOME-CREDITS UNDO (its table is gone) paste watch_launch_day_after_welcome_undo.sql instead: the same without row 13.
with r(n, what, value, look, when_look, what_you_do) as (
  select 1, 'emails sent today through Resend (its day ends 19:00 Ohio time)',
         (select count(*) from public.join_attempts where at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + (select count(*) from public.ops_outbox where mode = 'live' and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + (select count(*) from auth.users where recovery_sent_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         || ' of 100 (sign-up mails + alert mails + password resets we know of; the Resend dashboard is the exact number)',
         ((select count(*) from public.join_attempts where at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + (select count(*) from public.ops_outbox where mode = 'live' and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
         + (select count(*) from auth.users where recovery_sent_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')) >= 70,
         '70 or more',
         'Open the Resend dashboard for the exact count. At 90 or more, close sign-up until 19:00 Ohio (live step 48, sign-up OFF; step 47 opens it again after 19:00), because over 100 a sign-up email is refused and never retried. Tell CC1.'
  union all
  -- BUILDER 11-26: after live step 74 (the flood fix) join counts OPENED addresses against the size and every ask against the ask ceiling;
  -- before it, as join counts today. confirmed_at is read through to_jsonb so this paste never errors before step 74.
  select 2, 'sign-up size used today (as join counts: before step 74 every address asked for in 24 hours; after it, opened ones, and asks against the ceiling)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'join_attempts' and column_name = 'confirmed_at')
              then (select count(distinct j.email_hash) from public.join_attempts j where j.at > now() - interval '1 day' and (to_jsonb(j) ->> 'confirmed_at') is not null) || ' opened of ' || coalesce((select (to_jsonb(o) ->> 'join_daily_max')::int from public.ops_settings o limit 1), 200) || '; ' || (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') || ' asked of ' || coalesce((select (to_jsonb(o) ->> 'join_asks_max')::int from public.ops_settings o limit 1), 2 * coalesce((select (to_jsonb(o) ->> 'join_daily_max')::int from public.ops_settings o limit 1), 200)) || ' (the ask ceiling, step 74)'
              else (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day')
                   || ' of ' || coalesce((select (to_jsonb(o) ->> 'join_daily_max') from public.ops_settings o limit 1), '200 (no setting)') end,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'join_attempts' and column_name = 'confirmed_at')
              then (select count(distinct j.email_hash) from public.join_attempts j where j.at > now() - interval '1 day' and (to_jsonb(j) ->> 'confirmed_at') is not null) >= coalesce((select (to_jsonb(o) ->> 'join_daily_max')::int from public.ops_settings o limit 1), 200) - 5 or (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') >= coalesce((select (to_jsonb(o) ->> 'join_asks_max')::int from public.ops_settings o limit 1), 2 * coalesce((select (to_jsonb(o) ->> 'join_daily_max')::int from public.ops_settings o limit 1), 200)) - 5
              else (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') >= coalesce((select (to_jsonb(o) ->> 'join_daily_max')::int from public.ops_settings o limit 1), 200) - 5 end,
         'within 5 of the size (after step 74: opened within 5 of the size, or asks within 5 of the ceiling)',
         'Expected on a busy day; new strangers then read ''Sign-up is full for now''. Under Resend Free the size stays 35 (row 1). First read row 3: if it says LOOK, someone is filling the day with made-up addresses.'
  union all
  select 3, 'sign-up asks made 20 to 60 min ago vs accounts opened in the last hour (a flood of made-up addresses)',
         (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 hour' and at < now() - interval '20 minutes') || ' asked, '
         || (select count(*) from auth.users where email_confirmed_at > now() - interval '1 hour') || ' opened',
         (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 hour' and at < now() - interval '20 minutes') >= 10
           and (select count(*) from auth.users where email_confirmed_at > now() - interval '1 hour') = 0,
         '10 or more asked 20 to 60 min ago and 0 opened',
         'Close sign-up now with live step 48 (sign-up OFF) so the flood cannot use up the day and the email budget, and tell CC1; step 47 opens it again when CC1 says (LAUNCH-WED-1125.md: if the day''s 35 fill with addresses nobody opens).'
  union all
  select 4, 'sign-ups not opened 20 minutes after (made 20 to 60 min ago)',
         (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes' and email_confirmed_at is null)
         || ' of ' || (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes'),
         (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes') >= 2
           and 2 * (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes' and email_confirmed_at is null)
             > (select count(*) from auth.users where created_at > now() - interval '1 hour' and created_at < now() - interval '20 minutes'),
         'more than half of 2 or more',
         'The emails may not be arriving: Supabase, Edge Functions, join, Logs (lines starting join invite:) and the Resend dashboard (bounced or refused). Tell CC1.'
  union all
  select 5, 'jobs waiting for the render PC, and the oldest wait',
         (select count(*) from public.jobs where state = 'queued' and run_on = 'house') || ' waiting; oldest queued '
         || coalesce((select round(extract(epoch from now() - min(queued_at)) / 60)::text from public.jobs where state = 'queued' and run_on = 'house'), '0') || ' min ago',
         coalesce((select extract(epoch from now() - min(queued_at)) / 60 from public.jobs where state = 'queued' and run_on = 'house'), 0) > 30,
         'the oldest is over 30 min',
         'Check row 7 (is the render PC there?). At 25 waiting, or the oldest over 90 min, brake the queue with live step 71 (BUILDER), as LAUNCH-WED-1125.md says. Tell CC1.'
  union all
  select 6, 'jobs claimed by the render PC but not started after 10 minutes',
         (select count(*) from public.jobs where state = 'claimed' and run_on = 'house' and claimed_at < now() - interval '10 minutes')::text,
         (select count(*) from public.jobs where state = 'claimed' and run_on = 'house' and claimed_at < now() - interval '10 minutes') >= 1,
         '1 or more',
         'The render PC took a job and stalled: WORKER''s card proposals/WORKER-IF-IT-BREAKS-1125.md, step 1 (one read-only paste on the render PC). Tell CC1.'
  union all
  select 7, 'render PC last checked in',
         coalesce((select round(extract(epoch from now() - max(last_seen_at)) / 60)::text || ' min ago' from public.workers where enabled and last_seen_at is not null), 'never'),
         coalesce((select max(last_seen_at) from public.workers where enabled and last_seen_at is not null) < now() - interval '5 minutes', true),
         'over 5 min ago, or never',
         'If you ran WORKER''s item 5 or put a STOP file down in the last 15 min, this is expected (a stopped worker does not check in) and clears with its new start. Otherwise the render PC is off or cut off: WORKER''s card proposals/WORKER-IF-IT-BREAKS-1125.md, step 1. Strangers'' films wait meanwhile; nothing is lost.'
  union all
  select 8, 'failed or needs-decision jobs in the last hour, by code (of all jobs ended in the last hour)',
         coalesce((select string_agg(code || ' x' || k, ', ' order by k desc, code)
                     from (select coalesce(error_code, 'no_code') as code, count(*) as k from public.jobs
                            where state in ('failed', 'editorial_action_required') and ended_at > now() - interval '1 hour' group by 1) f), 'none')
         || ' (of ' || (select count(*) from public.jobs where ended_at > now() - interval '1 hour') || ' ended)',
         exists (select 1 from public.jobs where state in ('failed', 'editorial_action_required') and ended_at > now() - interval '1 hour'
                  group by coalesce(error_code, 'no_code') having count(*) >= 3)
           or exists (select 1 from public.jobs where state = 'failed' and ended_at > now() - interval '1 hour'
                       and error_code in ('queue_timeout', 'engine_unsupported', 'limit_exceeded', 'crash', 'start_failed', 'no_receipt', 'no_output', 'no_commit', 'worker_error', 'upload_failed', 'straggler')),
         'any one code 3 or more times, or any machine-side code',
         'Tell CC1 the codes (queue_timeout = the render PC is off: row 7; engine_unsupported = a blocked film got through). A stranger''s failed free preview by the machine is not counted against them (A14).'
  union all
  select 9, 'scheduled calls answered with an error in the last hour',
         (select count(*) filter (where status_code is null or status_code not between 200 and 299) from net._http_response where created > now() - interval '1 hour')
         || ' of ' || (select count(*) from net._http_response where created > now() - interval '1 hour'),
         (select count(*) filter (where status_code is null or status_code not between 200 and 299) from net._http_response where created > now() - interval '1 hour') >= 1,
         '1 or more',
         'Supabase, Edge Functions: open the function named in the error (ops-tick, purge-uploads, purge-partial-uploads), Logs. Tell CC1.'
  union all
  select 10, 'scheduled jobs: failed, not active, or ops-tick late',
         coalesce((select string_agg(j.jobname || ' ' || coalesce(d.status, 'never ran') || case when j.active then '' else ' NOT ACTIVE' end, ', ' order by j.jobname)
                     from cron.job j left join lateral (select x.status, x.start_time from cron.job_run_details x where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
                    where not j.active or d.status = 'failed' or (j.jobname = 'ops-tick' and coalesce(d.start_time, '-infinity'::timestamptz) < now() - interval '3 minutes')), 'none')
         || ' (' || (select count(*) from cron.job) || ' jobs)',
         exists (select 1 from cron.job j left join lateral (select x.status, x.start_time from cron.job_run_details x where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
                  where not j.active or d.status = 'failed' or (j.jobname = 'ops-tick' and coalesce(d.start_time, '-infinity'::timestamptz) < now() - interval '3 minutes')),
         'any is named',
         'Tell CC1 which. ops-tick late = the minute jobs (alerts, the queue clock) are not running.'
  union all
  select 11, 'full films waiting for YOUR approval (#/admin/renders)',
         (select count(*) from public.jobs where state = 'awaiting_approval') || ' waiting; oldest made '
         || coalesce((select round(extract(epoch from now() - min(created_at)) / 60)::text from public.jobs where state = 'awaiting_approval'), '0') || ' min ago',
         (select count(*) from public.jobs where state = 'awaiting_approval') >= 1,
         'any is waiting',
         'Approve or refuse it on #/admin/renders (only after WORKER''s item 5 is done).'
  union all
  select 12, 'account deletions waiting for YOU to close by hand',
         (select count(*) from public.account_deletion_requests) || ' waiting',
         (select count(*) from public.account_deletion_requests) >= 1,
         'any is waiting',
         'Their login is already blocked and their files gone; close the account by hand as the paper says (never delete the login: the credit record keeps it).'
  union all
  select 14, 'the server hands jobs to the render PC: claims switched on, and no sheet, preview or full film paused (public.control)',
         case when (select claims_enabled from public.control limit 1) then 'claims on' else 'claims OFF' end
         || '; paused types: ' || coalesce((select nullif(array_to_string(disabled_job_types, ', '), '') from public.control limit 1), 'none')
         || ' (film_bundle and scene_bundle are paused on purpose since 11-13)',
         not coalesce((select claims_enabled from public.control limit 1), false)
           or coalesce((select disabled_job_types && array['contact_sheet', 'preview', 'final_render']::public.job_type[] from public.control limit 1), false),
         'claims OFF, or contact_sheet, preview or final_render paused',
         'Then the render PC is fine but is handed nothing (WORKER''s card section B). Nobody is meant to switch this today: tell CC1 at once and do not change it yourself. (The queue brake, step 71, is NOT this: it only refuses NEW sheets and previews.)'
  -- ROW 13 START (watch_launch_day_after_welcome_undo.sql is this file without the lines from here to ROW 13 END)
  union all
  select 13, 'verified sign-ups in the last 24 hours that got NO welcome credits (live step 65)',
         (select count(*) from auth.users u
           where u.email_confirmed_at > now() - interval '24 hours'
             and not exists (select 1 from public.workers x where x.user_id = u.id)
             and not exists (select 1 from public.app_admins a where a.user_id = u.id)
             and not exists (select 1 from public.invite_redemptions i where i.email = lower(btrim(u.email)))
             and coalesce(u.raw_user_meta_data ->> 'adult_source', '') <> 'invite'
             and not exists (select 1 from ryagram_private.welcome_credit_grants g
                              where g.email_hash = encode(sha256(convert_to('ryagram-welcome:' || lower(btrim(u.email)), 'UTF8')), 'hex')))
         || ' (welcome setting ' || coalesce((select (to_jsonb(o) ->> 'welcome_credits') from public.ops_settings o limit 1), 'missing') || ')',
         coalesce((select (to_jsonb(o) ->> 'welcome_credits')::int from public.ops_settings o limit 1), 0) > 0
           and (select count(*) from auth.users u
                 where u.email_confirmed_at > now() - interval '24 hours'
                   and not exists (select 1 from public.workers x where x.user_id = u.id)
                   and not exists (select 1 from public.app_admins a where a.user_id = u.id)
                   and not exists (select 1 from public.invite_redemptions i where i.email = lower(btrim(u.email)))
                   and coalesce(u.raw_user_meta_data ->> 'adult_source', '') <> 'invite'
                   and not exists (select 1 from ryagram_private.welcome_credit_grants g
                                    where g.email_hash = encode(sha256(convert_to('ryagram-welcome:' || lower(btrim(u.email)), 'UTF8')), 'hex'))) >= 1,
         '1 or more while the setting is above 0',
         'A welcome grant failed (Supabase, Logs, Postgres: a welcome warning). Tell CC1, who names the repair step; never grant by hand (it would not record the address). Your own test sign-ups from Tuesday count here until 24 hours pass.'
  -- ROW 13 END
)
select n, what, value, case when n = 0 then '' when look then 'LOOK' else 'ok' end as status, when_look, what_you_do from (
  select 0 as n,
         case when not exists (select 1 from r where look) then 'OK: nothing to do (' || (select count(*) from r) || ' rows checked)'
              else 'LOOK: row(s) ' || (select string_agg(n::text, ', ' order by n) from r where look) || ': read their what_you_do' end as what,
         '' as value, false as look, '' as when_look, '' as what_you_do
  union all
  select n, what, value, look, when_look, what_you_do from r
) v
order by n;

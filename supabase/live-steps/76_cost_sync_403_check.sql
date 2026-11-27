-- LIVE STEP 76: WHY DOES THE HOURLY cost-sync CALL ANSWER 403 'Not allowed.'? (CONNECT 2026-11-26; Claude's 19:02 watch row 9, CC1 19:01). READ-ONLY, one SELECT, changes nothing, never prints a secret (it only compares and measures them). Every column is named.
-- WHAT THE 403 MEANS (read in git, supabase/functions/cost-sync/sync.ts:86 and _shared/ops_mail.ts whoCalls): the function runs and answers 403 only when the Authorization header of the call is NEITHER the job secret (the function's secret COST_SYNC_SECRET, 32 or more characters) NOR the service-role key. The job sends the Vault secret cron_cost_sync. So the two must be the SAME value.
-- HOW TO READ THE ROWS: rows 1 to 4 are about the SCHEDULER side (the job and its Vault secret). If they are ALL true and row 5 is false, the scheduler side is fine and the FUNCTION side is the fault: the function secret COST_SYNC_SECRET is not set, is shorter than 32 characters, or holds a different value than the Vault secret cron_cost_sync (this check cannot read function secrets). The fix is in proposals/CONNECT-COST-SYNC-403-1126.md.
-- A false row 1 to 4 is a scheduler-side fault: stop and send the grid to CC1 and CONNECT. Row 5 is true once an hourly call has been answered 200 and no 'Not allowed' came in the last 2 hours. Row 6 only says how many 'Not allowed' answers came in the last 24 hours (information, always true).
select 'the cost-sync job exists, is active and runs every hour at :00' as check_name,
       coalesce((select j.active and j.schedule = '0 * * * *' from cron.job j where j.jobname = 'cost-sync'), false) as ok
union all select 'its command sends the Vault secret cron_cost_sync, not the service-role key and not another job''s secret',
       coalesce((select j.command like '%cron_cost_sync%' and j.command not like '%service_role%' and j.command not like '%cron_ops_%' and j.command not like '%cron_purge_%'
                   from cron.job j where j.jobname = 'cost-sync'), false)
union all select 'the Vault secret cron_cost_sync exists and is 32 or more characters',
       coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_cost_sync'), false)
union all select 'it differs from every other cron_ secret (a secret for one job must not open another)',
       coalesce((select count(*) = 1 from vault.decrypted_secrets s where s.name = 'cron_cost_sync'), false)
       and not exists (select 1 from vault.decrypted_secrets a join vault.decrypted_secrets b on a.decrypted_secret = b.decrypted_secret and a.name < b.name where a.name like 'cron\_%' and b.name like 'cron\_%')
union all select 'no ''Not allowed'' answer in the last 2 hours (the function accepts the job''s secret)',
       not exists (select 1 from net._http_response r where r.status_code = 403 and r.content like '%Not allowed%' and r.created > now() - interval '2 hours')
union all select 'for your eyes only, not a check: ''Not allowed'' answers in the last 24 hours = ' || (select count(*) from net._http_response r where r.status_code = 403 and r.content like '%Not allowed%' and r.created > now() - interval '24 hours')::text,
       true;

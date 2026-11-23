-- BEFORE scheduling the two purge jobs (CONNECT 2026-11-23, CLAUDE's Q673 finding: live pg_cron has only ops-tick, ops-digest, cost-sync and connect-purge; purge-uploads and purge-partial-uploads are NOT scheduled).
-- READ-ONLY, one SELECT, changes nothing, never prints a secret (it only compares and measures them). Every column is named.
-- Rows 1 to 5 must ALL be true before step 54. A false row: stop, post the grid, do not schedule. Row 6 only says what is scheduled now (always true).
-- It needs the Vault secrets of the paper (proposals/CONNECT-PURGE-JOBS-LIVE-STEPS-1123.md, steps P2 and P3) in place first: cron_purge_uploads and cron_purge_partial, each 32 or more characters, each different from the other and from the three ops secrets.
select 'pg_cron and pg_net are installed' as check_name,
       exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') as ok
union all select 'the Vault secret cron_purge_uploads exists and is 32 or more characters',
       coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_purge_uploads'), false)
union all select 'the Vault secret cron_purge_partial exists and is 32 or more characters',
       coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_purge_partial'), false)
union all select 'the two purge secrets differ from each other and from every other cron_ secret (a secret for one job must not open another)',
       coalesce((select count(*) = 2 from vault.decrypted_secrets s where s.name in ('cron_purge_uploads', 'cron_purge_partial')), false)
       and coalesce((select count(distinct s.decrypted_secret) = count(*) from vault.decrypted_secrets s where s.name like 'cron\_%' escape '\'), false)
union all select 'no job reads the service-role key from the Vault any more (the existing jobs are clean)',
       coalesce((select not bool_or(j.command like '%service_role_key%') from cron.job j), true)
union all select 'jobs scheduled now: ' || coalesce((select string_agg(j.jobname, ', ' order by j.jobname) from cron.job j), 'none'), true;

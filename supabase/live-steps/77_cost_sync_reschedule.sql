-- LIVE STEP 77: SCHEDULE THE cost-sync JOB WITH ITS OWN VAULT SECRET (CONNECT 2026-11-26). A WRITE: run it ONCE, only when live step 76 row 2 was FALSE (the job sends the wrong secret, e.g. the old service-role key) or the job is missing, and the Vault secret cron_cost_sync is 32+ characters and DIFFERENT from every other cron_ secret.
-- If live step 76 rows 1 to 4 are all TRUE the job is already right: do NOT run this; the fault is the function secret COST_SYNC_SECRET (proposals/CONNECT-COST-SYNC-403-1126.md).
-- It REFUSES by itself (schedules nothing) when the Vault secret is missing, short, or equal to another job's. Running it again replaces the job with the same text (cron.schedule with an existing name replaces that job). Undo: live step 77b (the old job was failing every hour: nothing of value is lost).
do $do$
begin
  if not coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_cost_sync'), false) then
    raise exception 'Not scheduled: the Vault secret cron_cost_sync is missing or shorter than 32 characters.';
  end if;
  if exists (select 1 from vault.decrypted_secrets a join vault.decrypted_secrets b on a.decrypted_secret = b.decrypted_secret and a.name < b.name where a.name like 'cron\_%' and b.name like 'cron\_%') then
    raise exception 'Not scheduled: two cron_ Vault secrets hold the same value (a secret for one job must not open another).';
  end if;
  perform cron.schedule('cost-sync', '0 * * * *', $job$ select net.http_post(
    url := 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/cost-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_cost_sync')),
    body := '{}'::jsonb) $job$);
end $do$;
select j.jobname as job_name, j.schedule as schedule, j.active as active, position('cron_cost_sync' in j.command) > 0 as reads_its_own_secret, position('service_role' in j.command) = 0 as no_service_key
  from cron.job j where j.jobname = 'cost-sync';

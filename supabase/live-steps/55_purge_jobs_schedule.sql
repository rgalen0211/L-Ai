-- SCHEDULE the two purge jobs (CONNECT 2026-11-23). A WRITE: run it ONCE, in the live SQL Editor, only after live-steps/54 answered true on rows 1 to 5, the two functions are deployed with their secrets, and Ryan says go.
--   purge-uploads          every hour at :00  removes spreadsheets a person deleted or did not keep, unfinished uploads after a day, and the films made from removed uploads
--   purge-partial-uploads  every hour at :30  removes the files (contact sheets, previews) left by a job that FAILED or was CANCELLED, 24 hours after it ended: this one matters for the free preview even with uploads off
-- Each call carries its OWN per-job secret from the Vault, never the service-role key (pg_net keeps every scheduled call where every database login can read it).
-- It REFUSES BY ITSELF (nothing is scheduled) when a Vault secret is missing or short: a job that reads a missing secret would call the function with no key and be refused every hour without anyone noticing.
-- Running it again replaces the two jobs with the same text (cron.schedule with an existing name replaces that job). Undo: live-steps/57_purge_jobs_UNDO.sql.
do $do$
begin
  if not coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_purge_uploads'), false)
     or not coalesce((select bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_purge_partial'), false) then
    raise exception 'Not scheduled: the Vault secret cron_purge_uploads or cron_purge_partial is missing or shorter than 32 characters. Add them (paper steps P2 and P3), run live-steps/54, then this again.';
  end if;
  perform cron.schedule('purge-uploads', '0 * * * *', $job$ select net.http_post(
    url := 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/purge-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_purge_uploads')),
    body := '{}'::jsonb) $job$);
  perform cron.schedule('purge-partial-uploads', '30 * * * *', $job$ select net.http_post(
    url := 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/purge-partial-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_purge_partial')),
    body := '{}'::jsonb) $job$);
end $do$;
select j.jobname as job_name, j.schedule as schedule, j.active as active from cron.job j where j.jobname in ('purge-uploads', 'purge-partial-uploads') order by j.jobname;

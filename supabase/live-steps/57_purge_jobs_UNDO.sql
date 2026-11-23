-- UNDO of live-steps/55 (CONNECT 2026-11-23): stops the two purge jobs. A WRITE to cron only; nothing is deleted from any table or bucket, and files already removed stay removed.
-- Safe to run when a job is missing (it only unschedules what is there). To put them back: live-steps/55 again.
-- While they are stopped, deleted uploads and the files of failed jobs stay in Storage until they are scheduled again (they are hidden from people in the meantime: the database lists what is due; Storage keeps the bytes).
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'purge-uploads') then perform cron.unschedule('purge-uploads'); end if;
  if exists (select 1 from cron.job where jobname = 'purge-partial-uploads') then perform cron.unschedule('purge-partial-uploads'); end if;
end $do$;
select j.jobname as job_name, j.schedule as schedule, j.active as active from cron.job j order by j.jobname;

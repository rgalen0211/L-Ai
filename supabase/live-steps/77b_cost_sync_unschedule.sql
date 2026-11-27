-- LIVE STEP 77b: THE UNDO OF LIVE STEP 77 (CONNECT 2026-11-26): removes the cost-sync job (the cost ledger then stops syncing Stripe's fees until a job is scheduled again; buying is closed, so no fee is missed meanwhile). Runs fine when the job is not there.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'cost-sync') then perform cron.unschedule('cost-sync'); end if;
end $do$;
select count(*) as cost_sync_jobs_left from cron.job j where j.jobname = 'cost-sync';

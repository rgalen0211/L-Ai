-- Ryagram 2A follow-up: tell the app which engine version the render worker is running.
--
-- Run after 20260929000400_2a_ladder_engine_commit.sql. Read-only; changes no data.
-- The app uses it to disable "Render final film" when the preview was drawn by an older
-- engine than the worker runs now (the engine would refuse that final anyway, per
-- ladder_engine_commit). Until this runs, the app still checks sheet vs preview.
--
-- "Current" = the engine commit of the most recent job an enabled worker started.
-- Returns only a commit hash, never anything about other people's jobs.

begin;

create function public.current_engine_commit() returns text
language sql stable security definer set search_path = '' as $$
  select j.engine_commit
  from public.jobs j join public.workers w on w.user_id = j.worker_user_id and w.enabled
  where j.engine_commit is not null and j.started_at is not null
  order by j.started_at desc
  limit 1
$$;

revoke execute on function public.current_engine_commit() from public, anon;
grant execute on function public.current_engine_commit() to authenticated;

commit;

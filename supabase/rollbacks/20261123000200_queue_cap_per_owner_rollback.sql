-- QUEUE CAP PER OWNER: the exact undo of migrations/20261123000200_queue_cap_per_owner.sql. NOT a migration: it lives outside
-- migrations/ so nothing applies it by accident. If 20261123000300 is applied, run its rollback FIRST (this file refuses otherwise).
-- It drops the ryagram_private.submit_job_for wrapper, renames pipe1's function (submit_job_for_base, never edited) back to
-- submit_job_for, and drops the cap check and its ops_settings column (a value Ryan set is lost with it: write it down first).
-- public.submit_job was never touched, so nothing about it changes.
begin;

do $$
begin
  if to_regclass('ryagram_private.blocked_story_views') is not null then
    raise exception 'Undo 20261123000300 first: run rollbacks/20261123000300_blocked_story_views_rollback.sql, then this file.';
  end if;
end $$;

drop function ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid);
alter function ryagram_private.submit_job_for_base(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)
  rename to submit_job_for;

drop function ryagram_private.queue_cap_check(uuid);
alter table public.ops_settings drop column queue_cap_per_owner;

commit;

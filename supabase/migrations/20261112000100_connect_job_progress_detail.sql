-- The step words and the time left in the AI chat (launch slice IN 1; WORKER's walkthrough row A10; GAMES for CC1, 2026-11-12). NOT APPLIED.
--
-- The website's jobs page shows a running job's step, its count and a time left from jobs.progress_detail (the worker's heartbeat, migrations/20261003000100_job_progress_detail.sql).
-- The connector's job_status read the same job through public.connect_job, which did not return that field, so the chat could only say "N% done".
-- This recreates public.connect_job with ONE key added, 'progress_detail', and NOTHING else changed: the same signature (text, uuid) and return type (jsonb), so CREATE OR REPLACE
-- keeps its owner and its grants (connect_runner only); the same security definer and empty search_path; the same 'read' scope check and the same owner check
-- (owner_id = the token's own account), so a job of another account still answers null and its progress_detail is never read.
-- The field is the worker's own numbers (stage, done, total, unit, eta_s, eta_is_a_guess, total_is_provisional), held to that shape by ryagram_private.progress_detail_ok
-- and to 1024 bytes by the column's check; the connector shows only a stage from its fixed list and numbers, never text from it.
-- Undo: rollbacks/20261112000100_connect_job_progress_detail_rollback.sql restores today's function exactly. After-check: live-steps/24_connect_job_progress_detail_after_check.sql.

begin;

create or replace function public.connect_job(p_token_hash text, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', j.id, 'version_id', j.version_id, 'job_type', j.job_type, 'state', j.state, 'attempt', j.attempt,
    'created_at', j.created_at, 'story_sha256', j.story_sha256, 'engine_commit', j.engine_commit, 'error_class', j.error_class,
    'error_code', j.error_code, 'error_detail', j.error_detail, 'progress', j.progress, 'note', j.progress_note,
    'queue_position', public.queue_position(j.id), 'progress_detail', j.progress_detail);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (a test fails otherwise); connect_job is the connector login's only, so the gate leaves it as it is
commit;

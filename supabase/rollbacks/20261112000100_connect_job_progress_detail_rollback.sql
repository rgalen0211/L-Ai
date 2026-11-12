-- THE STEP WORDS IN THE AI CHAT: the exact undo of migrations/20261112000100_connect_job_progress_detail.sql (GAMES, 2026-11-12). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It puts back public.connect_job exactly as migrations/20261018000100_connect_ai.sql made it (no 'progress_detail' key). CREATE OR REPLACE keeps the owner and the grants (connect_runner only).
-- What changes for the person: the AI chat's job_status says the step and the time left are not reported, and shows only "N% done", as before. No data is lost; jobs.progress_detail stays.
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
    'queue_position', public.queue_position(j.id));
end $$;

commit;

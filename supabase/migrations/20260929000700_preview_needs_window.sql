-- A preview must say which seconds to draw (WORKER, 2026-09-29).
--
-- The worker rejects a preview job without params.window_s (schema_rejected), so a
-- preview queued without one can never run. Refuse it at submit time instead.
--
-- A BEFORE INSERT trigger rather than a check constraint: it gives a plain message
-- (22023 -> HTTP 400), and it leaves existing rows alone. The shape and bounds of
-- window_s are already checked in submit_job; this only makes it required.
-- retry_job requeues the same row (an UPDATE), so retries are unaffected.
-- Trigger name sorts before the 2B ledger's jobs_quote, so a refused preview is never quoted.

begin;

create or replace function ryagram_private.preview_needs_window()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.job_type = 'preview' and not coalesce(new.params ? 'window_s', false) then
    raise exception 'A preview needs window_s: [start, end] in seconds, at most 10 seconds long.'
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function ryagram_private.preview_needs_window() from public, anon, authenticated;

drop trigger if exists jobs_preview_needs_window on public.jobs;
create trigger jobs_preview_needs_window
  before insert on public.jobs
  for each row execute function ryagram_private.preview_needs_window();

commit;

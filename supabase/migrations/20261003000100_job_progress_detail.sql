-- Live render progress in the app: stage, how far, how much longer (WEB + WORKER, MAILBOX
-- 2026-10-03). NOT APPLIED.
--
-- The worker already sends heartbeat(p_progress, p_note). This adds p_detail: the engine's own
-- progress.json numbers, passed through by the worker, stored as jobs.progress_detail and read
-- by the render panel. Shape (every key optional; anything else is refused):
--   stage                 text: starting | drawing | encoding | checks | uploading | done
--                         (the engine's stage names; the worker adds uploading)
--   done, total           numbers >= 0: this stage's count (frames for drawing, clips for checks);
--                         no total = the stage counts nothing (encoding, the data build)
--   unit                  text: frames | clips
--   eta_s                 number >= 0: seconds left in THIS stage, or absent
--   eta_is_a_guess        boolean: the app marks the ETA "~" when true (the engine always says so)
--   total_is_provisional  boolean: the total may still change
-- Old workers keep working: the three-argument call resolves to this function with p_detail null.

begin;

alter table public.jobs add column progress_detail jsonb
  check (progress_detail is null or (jsonb_typeof(progress_detail) = 'object' and pg_column_size(progress_detail) <= 1024));

create function ryagram_private.progress_detail_ok(d jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select d is null or (
    jsonb_typeof(d) = 'object'
    and not exists (select 1 from jsonb_object_keys(d) k
                    where k not in ('stage', 'done', 'total', 'unit', 'eta_s', 'eta_is_a_guess', 'total_is_provisional'))
    and (not d ? 'stage' or (jsonb_typeof(d->'stage') = 'string'
                             and d->>'stage' in ('starting', 'drawing', 'encoding', 'checks', 'uploading', 'done')))
    and (not d ? 'unit' or d->'unit' = 'null'::jsonb or (jsonb_typeof(d->'unit') = 'string' and d->>'unit' in ('frames', 'clips')))
    and (not d ? 'done' or d->'done' = 'null'::jsonb or (jsonb_typeof(d->'done') = 'number' and (d->>'done')::numeric >= 0))
    and (not d ? 'total' or d->'total' = 'null'::jsonb or (jsonb_typeof(d->'total') = 'number' and (d->>'total')::numeric >= 0))
    and (not d ? 'eta_s' or d->'eta_s' = 'null'::jsonb or (jsonb_typeof(d->'eta_s') = 'number' and (d->>'eta_s')::numeric >= 0))
    and (not d ? 'eta_is_a_guess' or jsonb_typeof(d->'eta_is_a_guess') = 'boolean')
    and (not d ? 'total_is_provisional' or jsonb_typeof(d->'total_is_provisional') = 'boolean'))
$$;

drop function public.heartbeat(uuid, numeric, text);
create function public.heartbeat(p_job_id uuid, p_progress numeric default null, p_note text default null,
                                 p_detail jsonb default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  wants_cancel boolean;
begin
  if not ryagram_private.progress_detail_ok(p_detail) then
    raise exception 'progress detail must be an object with only stage, done, total, unit, eta_s, eta_is_a_guess, total_is_provisional.'
      using errcode = '22023';
  end if;
  update public.jobs set heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes',
      progress = coalesce(p_progress, progress), progress_note = coalesce(left(p_note, 200), progress_note),
      progress_detail = coalesce(p_detail, progress_detail)
    where id = p_job_id and worker_user_id = w.user_id
      and state in ('claimed', 'running', 'validating', 'uploading')
    returning cancel_requested into wants_cancel;
  if not found then
    raise exception 'This worker does not hold job %.', p_job_id using errcode = '42501';
  end if;
  return wants_cancel;
end $$;

-- A job sent back to the queue (lease lost, retry) starts its progress again. The functions that
-- requeue already clear progress and progress_note; this clears the detail with them.
create function ryagram_private.jobs_progress_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.state = 'queued' and old.state is distinct from 'queued' then
    new.progress_detail := null;
  end if;
  return new;
end $$;
create trigger jobs_progress_reset before update of state on public.jobs
  for each row execute function ryagram_private.jobs_progress_reset();

revoke execute on function public.heartbeat(uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.heartbeat(uuid, numeric, text, jsonb) to authenticated;
revoke execute on function ryagram_private.progress_detail_ok(jsonb), ryagram_private.jobs_progress_reset()
  from public, anon, authenticated;

commit;

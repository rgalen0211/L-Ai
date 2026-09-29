-- Ryagram 2A follow-up: fixes from WORKER's tests against the real SQL.
--
-- Run after 20260928000300_2a_worker_is_not_a_person.sql (SQL Editor -> New query -> paste -> Run).
-- WORKER ran its production client against all earlier migrations (206 checks) and found:
--  1. error code no_output ("engine exited 0 but wrote no film") classed as unknown. Now
--     infrastructure, and still not retried, like no_receipt / no_commit.
--  2. A cancel requested while a job was validating or uploading had no legal move, so the worker
--     sat idle until the 2-minute lease ran out. report_state now accepts validating -> cancelled
--     and uploading -> cancelled, still only when the owner asked.
--  3. Queue wait on a retried attempt counted attempt 1's run time. New jobs.queued_at is set at
--     submit and again each time a job is put back in the queue; the worker's
--     queue_wait_s = claimed_at - queued_at. Queue ORDER is unchanged (original submit time),
--     and what people are shown still counts from the first submit (created_at).
--  4. A job that failed or was cancelled mid-upload left its partial files behind. People now see
--     only files of completed jobs (table and Storage, enforced here, not just in the page), and
--     partial files are deleted after 24 hours by the purge-partial-uploads Edge Function, which
--     uses the two service_role-only functions at the end.
-- Each function below is the core file's version with only those changes.
-- create or replace keeps owners and grants.

begin;

alter table public.jobs add column queued_at timestamptz not null default now();
update public.jobs set queued_at = created_at;

create or replace function ryagram_private.error_class_for(code text) returns public.error_class
language sql immutable set search_path = '' as $$
  select case
    when code in ('schema_rejected', 'engine_unsupported', 'engine_refused', 'dataset_not_allowed',
                  'ladder_missing') then 'invalid_input'
    when code = 'gate_failed' then 'gate'
    when code in ('crash', 'start_failed', 'worker_lost', 'worker_error', 'upload_failed',
                  'no_receipt', 'no_commit', 'no_output') then 'infrastructure'
    when code = 'timeout' then 'timeout'
    when code = 'limit_exceeded' then 'limit'
    when code = 'cancelled' then 'cancelled'
    else 'unknown'
  end::public.error_class
$$;

-- Returns zero or one job. Also puts back jobs whose worker stopped heartbeating.
-- The worker's identity is its login; there is no worker_id argument to trust.
create or replace function public.claim_next_job()
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  ctl public.control;
  lost public.jobs;
  j public.jobs;
begin
  -- Expired leases: record the lost attempt, then retry or fail.
  for lost in
    select * from public.jobs
    where state in ('claimed', 'running', 'validating', 'uploading') and lease_expires_at < now()
    for update skip locked
  loop
    insert into public.job_metering (job_id, attempt, owner_id, project_id, version_id, job_type, error_code)
      values (lost.id, lost.attempt, lost.owner_id, lost.project_id, lost.version_id, lost.job_type, 'worker_lost')
      on conflict (job_id, attempt) do update set error_code = coalesce(public.job_metering.error_code, 'worker_lost');
    update public.jobs set
        state = case when lost.cancel_requested then 'cancelled'::public.job_state
                     when lost.attempt < 3 then 'queued'::public.job_state
                     else 'failed'::public.job_state end,
        attempt = case when not lost.cancel_requested and lost.attempt < 3 then lost.attempt + 1 else lost.attempt end,
        error_code = case when lost.cancel_requested then 'cancelled' else 'worker_lost' end,
        error_class = case when lost.cancel_requested then 'cancelled'::public.error_class
                           else 'infrastructure'::public.error_class end,
        error_detail = case when not lost.cancel_requested then 'The worker stopped responding.' end,
        ended_at = case when lost.cancel_requested or lost.attempt >= 3 then now() end,
        claimed_at = null, started_at = null, lease_expires_at = null, heartbeat_at = null,
        worker_id = null, worker_user_id = null, progress = null, progress_note = null,
        queued_at = case when not lost.cancel_requested and lost.attempt < 3 then now() else lost.queued_at end
      where id = lost.id;
  end loop;

  select * into ctl from public.control where id;
  if not ctl.claims_enabled then
    return;
  end if;
  -- One job at a time per worker.
  if exists (select 1 from public.jobs where worker_user_id = w.user_id
               and state in ('claimed', 'running', 'validating', 'uploading')) then
    return;
  end if;

  select * into j from public.jobs
    where state = 'queued' and job_type <> all (ctl.disabled_job_types)
    order by created_at, id
    for update skip locked
    limit 1;
  if not found then
    return;
  end if;

  -- Re-check the ladder at claim time: a job row alone is not evidence.
  if j.job_type = 'final_render' and not ryagram_private.ladder_ok(j) then
    update public.jobs set state = 'failed', ended_at = now(),
        error_code = 'ladder_missing', error_class = 'invalid_input',
        error_detail = 'Contact sheet, preview or approval missing for this exact story.'
      where id = j.id;
    return;
  end if;

  update public.jobs set state = 'claimed', claimed_at = now(), heartbeat_at = now(),
      lease_expires_at = now() + interval '2 minutes',
      worker_id = w.name, worker_user_id = w.user_id
    where id = j.id
    returning * into j;
  -- The metering row for this attempt, owned by this worker from now on.
  insert into public.job_metering (job_id, attempt, owner_id, project_id, version_id, job_type, worker_user_id)
    values (j.id, j.attempt, j.owner_id, j.project_id, j.version_id, j.job_type, w.user_id)
    on conflict (job_id, attempt) do update set worker_user_id = excluded.worker_user_id;
  return next j;
end $$;

-- Moves a held job forward, or ends it. Only these moves are legal (the same
-- table as WORKER's FakeQueue):
--   claimed    -> running | failed | cancelled
--   running    -> validating | failed | editorial_action_required | cancelled
--   validating -> uploading | failed | editorial_action_required | cancelled
--   uploading  -> complete | failed | cancelled
-- cancelled is accepted only when the owner asked (cancel_requested).
-- failed is final. To retry a transient failure, call retry_job instead.
create or replace function public.report_state(
  p_job_id uuid,
  p_state public.job_state,
  p_error_code text default null,
  p_error_detail text default null,
  p_engine_commit text default null,
  p_engine_dirty boolean default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  j public.jobs;
  missing text;
begin
  select * into j from public.jobs
    where id = p_job_id and worker_user_id = w.user_id
      and state in ('claimed', 'running', 'validating', 'uploading')
    for update;
  if not found then
    raise exception 'This worker does not hold job %.', p_job_id using errcode = '42501';
  end if;
  if not (j.state::text, p_state::text) in (
       ('claimed', 'running'), ('claimed', 'failed'), ('claimed', 'cancelled'),
       ('running', 'validating'), ('running', 'failed'), ('running', 'editorial_action_required'), ('running', 'cancelled'),
       ('validating', 'uploading'), ('validating', 'failed'), ('validating', 'editorial_action_required'), ('validating', 'cancelled'),
       ('uploading', 'complete'), ('uploading', 'failed'), ('uploading', 'cancelled')) then
    raise exception 'Cannot move a job from % to %.', j.state, p_state using errcode = '22023';
  end if;

  if p_engine_commit is not null then
    update public.jobs set engine_commit = p_engine_commit, engine_dirty = p_engine_dirty
      where id = j.id returning * into j;
  end if;

  if p_state in ('running', 'validating', 'uploading') then
    update public.jobs set state = p_state, heartbeat_at = now(),
        lease_expires_at = now() + interval '2 minutes',
        started_at = case when p_state = 'running' then now() else started_at end
      where id = j.id returning * into j;

  elsif p_state = 'complete' then
    if j.engine_commit is null then
      raise exception 'Record engine_commit before completing.' using errcode = '22023';
    end if;
    select string_agg(k::text, ', ') into missing
      from unnest(ryagram_private.required_kinds(j.job_type)) k
      where not exists (select 1 from public.artifacts a where a.job_id = j.id and a.kind = k);
    if missing is not null then
      raise exception 'Missing artifacts: %.', missing using errcode = '22023';
    end if;
    select string_agg(a.kind::text, ', ') into missing
      from public.artifacts a
      where a.job_id = j.id
        and not exists (select 1 from storage.objects o
                        where o.bucket_id = a.bucket and o.name = a.storage_path
                          and (o.metadata->>'size')::bigint = a.bytes
                          and o.metadata->>'mimetype' = a.mime);
    if missing is not null then
      raise exception 'Not uploaded, or size/type differs from what was registered: %.', missing
        using errcode = '22023';
    end if;
    update public.jobs set state = 'complete', ended_at = now(), lease_expires_at = null,
        progress = 1, error_code = null, error_class = null, error_detail = null
      where id = j.id returning * into j;

  elsif p_state = 'cancelled' then
    if not j.cancel_requested then
      raise exception 'Nobody asked to cancel this job.' using errcode = '22023';
    end if;
    update public.jobs set state = 'cancelled', ended_at = now(), lease_expires_at = null,
        error_code = 'cancelled', error_class = 'cancelled'
      where id = j.id returning * into j;

  else  -- failed, editorial_action_required: final
    p_error_code := coalesce(p_error_code, case when p_state = 'editorial_action_required' then 'gate_failed' end);
    if p_error_code is null then
      raise exception 'A failure needs an error_code.' using errcode = '22023';
    end if;
    update public.jobs set state = p_state, ended_at = now(), lease_expires_at = null,
        error_code = p_error_code, error_class = ryagram_private.error_class_for(p_error_code),
        error_detail = left(p_error_detail, 2000)
      where id = j.id returning * into j;
  end if;
  return j;
end $$;

-- Hands a held job back after a transient failure: queued again with the
-- attempt counted, or failed if that was attempt 3. Returns 'queued' or 'failed'.
-- Refuses codes that are not retryable (gate failures, timeouts, bad input):
-- those end with report_state(..., 'failed' or 'editorial_action_required').
create or replace function public.retry_job(p_job_id uuid, p_error_code text, p_error_detail text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  j public.jobs;
begin
  select * into j from public.jobs
    where id = p_job_id and worker_user_id = w.user_id
      and state in ('claimed', 'running', 'validating', 'uploading')
    for update;
  if not found then
    raise exception 'This worker does not hold job %.', p_job_id using errcode = '42501';
  end if;
  if not ryagram_private.is_retryable(p_error_code) then
    raise exception '% is not retryable; report the job failed instead.', p_error_code using errcode = '22023';
  end if;
  update public.job_metering set error_code = coalesce(error_code, p_error_code)
    where job_id = j.id and attempt = j.attempt;
  update public.jobs set
      state = case when j.attempt < 3 then 'queued'::public.job_state else 'failed'::public.job_state end,
      attempt = least(j.attempt + 1, 3),
      error_code = p_error_code, error_class = ryagram_private.error_class_for(p_error_code),
      error_detail = left(p_error_detail, 2000),
      ended_at = case when j.attempt >= 3 then now() end,
      claimed_at = null, started_at = null, lease_expires_at = null, heartbeat_at = null,
      worker_id = null, worker_user_id = null, progress = null, progress_note = null,
      queued_at = case when j.attempt < 3 then now() else j.queued_at end
    where id = j.id returning * into j;
  return j.state::text;
end $$;


-- 4a. Hide partial uploads at once: owners read only files of their COMPLETED jobs.
create function ryagram_private.owner_may_read(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.artifacts a join public.jobs j on j.id = a.job_id
    where a.storage_path = object_name and a.owner_id = auth.uid()
      and a.deleted_at is null and j.state = 'complete')
$$;
revoke execute on function ryagram_private.owner_may_read(text) from public, anon;
grant execute on function ryagram_private.owner_may_read(text) to authenticated;   -- storage policy calls it

drop policy "Owners read artifacts" on public.artifacts;
create policy "Owners read artifacts of completed jobs" on public.artifacts for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null
         and exists (select 1 from public.jobs j where j.id = job_id and j.state = 'complete'));

drop policy "Owners read their artifacts" on storage.objects;
create policy "Owners read files of completed jobs" on storage.objects for select to authenticated
  using (bucket_id = 'ryagram-artifacts' and ryagram_private.owner_may_read(name));

-- 4b. Delete after 24 hours. Files of jobs that ended without completing, 24 h after they ended.
-- Only the purge Edge Function (service_role) calls these; it removes the Storage objects
-- through the Storage API, then marks the rows deleted.
create function public.partial_uploads_due(p_limit int default 500)
returns table (artifact_id uuid, bucket text, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.bucket, a.storage_path
  from public.artifacts a join public.jobs j on j.id = a.job_id
  where a.deleted_at is null
    and j.state in ('failed', 'cancelled', 'editorial_action_required')
    and j.ended_at < now() - interval '24 hours'
  order by j.ended_at
  limit least(greatest(p_limit, 1), 1000)
$$;

create function public.mark_uploads_deleted(p_artifact_ids uuid[]) returns int
language sql security definer set search_path = '' as $$
  with done as (
    update public.artifacts a set deleted_at = now()
    from public.jobs j
    where j.id = a.job_id and a.id = any (p_artifact_ids) and a.deleted_at is null
      and j.state <> 'complete'                        -- never a finished job's files
      and not exists (select 1 from storage.objects o  -- only once the file is really gone
                      where o.bucket_id = a.bucket and o.name = a.storage_path)
    returning a.id)
  select count(*)::int from done
$$;

revoke execute on function public.partial_uploads_due(int), public.mark_uploads_deleted(uuid[])
  from public, anon, authenticated;
grant execute on function public.partial_uploads_due(int), public.mark_uploads_deleted(uuid[]) to service_role;
grant usage on schema public to service_role;                    -- "expose new tables" is OFF

commit;

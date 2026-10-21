-- r9 M3 ROLLBACK (WORKER): the exact undo of supabase/migrations/20261021000100_r9_render_node.sql. NOT a migration: it
-- lives outside migrations/ so nothing ever applies it automatically. Use ONLY if r9 was applied and must come out, with
-- house claims PAUSED as for the apply (proposals\WORKER-R9-BACKUP-AND-ROLLBACK.md C2). One transaction (begin ... commit).
-- BEFORE IT: a dated export of the database exists (proposals\WORKER-R9-BACKUP-AND-ROLLBACK.md).
-- WHAT IT LOSES: who is a tester and its audit history, every signed-in computer, and which jobs ran or would run on a person's
-- own computer. Jobs themselves, their files and the credits ledger are untouched.
-- FIRST it cancels every QUEUED owner_local job: once run_on is gone the house worker would otherwise claim a job that was
-- quoted 0 credits. A local job that is mid-render is cancelled the same way (its computer can no longer report on it).

begin;

update public.jobs set state = 'cancelled', error_code = 'cancelled', error_class = 'cancelled', ended_at = now(),
    error_detail = 'Rendering on your own computer was switched off, so this job will not run.'
  where run_on = 'owner_local' and state in ('queued', 'claimed', 'running', 'validating', 'uploading');

-- the two live functions back to their original text (pipe1's claim; 2a_core's require_worker), copied from the migrations
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
                     when lost.attempt < 2 then 'queued'::public.job_state
                     else 'failed'::public.job_state end,
        attempt = case when not lost.cancel_requested and lost.attempt < 2 then lost.attempt + 1 else lost.attempt end,
        error_code = case when lost.cancel_requested then 'cancelled' else 'worker_lost' end,
        error_class = case when lost.cancel_requested then 'cancelled'::public.error_class
                           else 'infrastructure'::public.error_class end,
        error_detail = case when not lost.cancel_requested then 'The worker stopped responding.' end,
        ended_at = case when lost.cancel_requested or lost.attempt >= 2 then now() end,
        claimed_at = null, started_at = null, lease_expires_at = null, heartbeat_at = null,
        worker_id = null, worker_user_id = null, progress = null, progress_note = null,
        queued_at = case when not lost.cancel_requested and lost.attempt < 2 then now() else lost.queued_at end
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

create or replace function ryagram_private.require_worker() returns public.workers
language plpgsql stable security definer set search_path = '' as $$
declare w public.workers;
begin
  select * into w from public.workers where user_id = auth.uid() and enabled;
  if not found then
    raise exception 'Not an enabled worker.' using errcode = '42501';
  end if;
  return w;
end $$;

drop function if exists public.node_claim(text);
drop function if exists public.node_heartbeat(text, uuid, numeric, text, jsonb);
drop function if exists public.node_report_state(text, uuid, public.job_state, text, text, text, boolean);
drop function if exists public.node_retry(text, uuid, text, text);
drop function if exists public.node_register_artifact(text, uuid, public.artifact_kind, bigint, text, numeric, int, int);
drop function if exists public.node_account(text);
drop function if exists public.node_signout(text);
drop function if exists public.node_hit(text, text, int, int);
drop function if exists public.node_device_begin(text, text, text);
drop function if exists public.node_device_exchange(text, text);
drop function if exists public.device_request_check(text);
drop function if exists public.device_decide(text, boolean);
drop function if exists public.my_computers();
drop function if exists public.remove_computer(uuid);
drop function if exists public.admin_storage_usage();
drop function if exists public.admin_local_compute_audit();
drop function if exists public.admin_set_local_compute_by_email(text, boolean, text);
drop function if exists public.admin_set_local_compute(uuid, boolean, text);
drop function if exists ryagram_private.node_job(uuid, uuid);
drop function if exists ryagram_private.node_actor(text);
drop function if exists ryagram_private.in_node_tx();
drop function if exists ryagram_private.node_sweep();
drop function if exists ryagram_private.masked_email(uuid);
drop function if exists ryagram_private.node_user_hit(uuid, text, int, int);

drop trigger if exists jobs_run_on on public.jobs;
drop trigger if exists jobs_run_on_fixed on public.jobs;
drop function if exists ryagram_private.jobs_place();
drop function if exists ryagram_private.jobs_place_fixed();
alter table public.jobs drop column if exists node_token_id;
alter table public.jobs drop column if exists run_on;
drop type if exists public.job_place;

drop table if exists ryagram_private.node_tx;
drop table if exists public.node_buckets;
drop table if exists public.node_tokens;
drop table if exists public.device_codes;
drop table if exists public.local_compute_audit;
alter table public.account_settings drop column if exists local_compute;

-- the role: first made harmless (no login, no rights), then dropped. If another database on the same server still holds
-- grants to it (only on a shared test server; live has one database), it stays, harmless, and a notice says so.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'node_runner') then
    alter role node_runner nologin;
    revoke usage on schema public from node_runner;
    begin
      drop role node_runner;
    exception when dependent_objects_still_exist then
      raise notice 'node_runner kept (no login, no rights): another database on this server still names it';
    end;
  end if;
end $$;

commit;

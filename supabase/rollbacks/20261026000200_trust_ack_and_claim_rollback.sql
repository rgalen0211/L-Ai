-- THE EXACT UNDO of migrations/20261026000200_trust_ack_and_claim.sql (Q239 B2). NOT a migration: it lives outside migrations/ so nothing applies it by itself. Generated from the database state BEFORE that step
-- (every function below is that state's own definition, as Postgres prints it), and TESTED on a scratch Postgres: applying the step and then this file gives back the identical schema, grants included.
-- It LOSES jobs.upload_trust (the label each job carried for the worker's check) and goes back to the two-argument confirm_dataset_mapping (the database no longer demands the tick).
begin;

drop function public.confirm_dataset_mapping(uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.claim_next_job()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  w public.workers := ryagram_private.require_worker();
  ctl public.control;
  lost public.jobs;
  j public.jobs;
begin
  if ryagram_private.in_node_tx() then                                                               -- WORKER r9
    raise exception 'A node claims with node_claim, never with the house claim.' using errcode = '42501';   -- WORKER r9
  end if;                                                                                            -- WORKER r9
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
      and run_on = 'house'                                                                             -- WORKER r9
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
end $function$;

CREATE OR REPLACE FUNCTION public.node_claim(p_access_hash text)
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := ryagram_private.node_actor(p_access_hash); ctl public.control; j public.jobs;
begin
  if not exists (select 1 from public.account_settings s where s.owner_id = me and s.local_compute) then
    raise exception 'This account is not set to render on its own computer.' using errcode = '42501';
  end if;
  perform ryagram_private.reap_lost_leases();          -- the same lease rules as the house: an expired local job requeues to its owner
  perform ryagram_private.node_sweep();
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  if exists (select 1 from public.jobs where worker_user_id = me and state in ('claimed', 'running', 'validating', 'uploading')) then
    return;                                            -- one job at a time per computer's owner
  end if;
  select * into j from public.jobs
    where state = 'queued' and owner_id = me and run_on = 'owner_local' and job_type <> all (ctl.disabled_job_types)
    order by created_at, id for update skip locked limit 1;
  if not found then return; end if;
  if j.job_type = 'final_render' and not ryagram_private.ladder_ok(j) then
    update public.jobs set state = 'failed', ended_at = now(), error_code = 'ladder_missing', error_class = 'invalid_input',
        error_detail = 'Contact sheet, preview or approval missing for this exact story.'
      where id = j.id;
    return;
  end if;
  update public.jobs set state = 'claimed', claimed_at = now(), heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes',
      worker_id = 'node', worker_user_id = me,
      node_token_id = (select n.token_id from ryagram_private.node_tx n where n.txid = txid_current())
    where id = j.id returning * into j;
  insert into public.job_metering (job_id, attempt, owner_id, project_id, version_id, job_type, worker_user_id)
    values (j.id, j.attempt, j.owner_id, j.project_id, j.version_id, j.job_type, me)
    on conflict (job_id, attempt) do update set worker_user_id = excluded.worker_user_id;
  return next j;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  problem text;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
  if not found then
    raise exception 'Dataset not found.' using errcode = 'PT404';
  end if;
  if d.ingest_report is null then
    raise exception 'We haven''t finished reading this file yet.' using errcode = '22023';
  end if;
  problem := ryagram_private.mapping_ok(p_mapping, d.ingest_report);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;
  -- This button IS the "use it anyway" press: the screen that shows it also shows the trust label and its warning (WEB). The moment is recorded.
  update public.datasets set mapping = p_mapping, geography = p_mapping->>'geography', status = 'approved',
                             trust_ack_at = coalesce(trust_ack_at, now()), last_activity_at = now() where id = d.id;
end $function$;

revoke execute on function public.confirm_dataset_mapping(uuid, jsonb) from public, anon;
grant execute on function public.confirm_dataset_mapping(uuid, jsonb) to authenticated;

drop function ryagram_private.upload_trust_for(uuid, jsonb);
alter table public.jobs drop column upload_trust;

commit;

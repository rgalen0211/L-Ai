-- r9 M3 DRAFT (WORKER, NEXT-WORKER 29, 2026-10-20). NEVER APPLIED, NEVER ON LIVE. Applying it is a later Ryan row.
-- Loaded only by supabase/tests/test_r9_node.py, AFTER every file in migrations/. Design: proposals\R9-REAL-PRODUCT-PLAN.md
-- (CONNECT 97) and proposals\WORKER-R9-REMOTE-NODE-NOTES.md; CC1 13:20 and 13:34.
--
-- WHAT IT ADDS
--   * a tester flag, account_settings.local_compute: set ONLY by an admin, every change in local_compute_audit;
--   * jobs.run_on 'house' | 'owner_local', fixed by the server when the job is ordered (a tester's job is owner_local)
--     and never changed after; an owner_local job is forced to credits_quoted = 0, so the ledger holds nothing;
--   * the house worker's claim takes ONLY run_on = 'house' and refuses to run inside a node call;
--   * a render NODE: a person's own computer, signed in by device code (no password in the app). The app holds a narrow
--     opaque token; the edge function 'node' (role node_runner, EXECUTE on node_* only, no table privileges) passes its
--     sha256 to node_* functions. NO node_* function takes an owner id: the person comes from the live token only.
--   * the node reuses the worker's own state machine (heartbeat, report_state, retry_job, register_artifact): node_actor
--     proves the token and records (this transaction, this person) in ryagram_private.node_tx; require_worker() accepts
--     that row as the job holder for THIS transaction only. No API role can write a row there.

begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'node_runner') then
    create role node_runner nologin noinherit;
  end if;
end $$;
grant usage on schema public to node_runner;

-- ----------------------------------------------------------------------------------------------- the tester flag
alter table public.account_settings add column local_compute boolean not null default false;
-- the existing column grants name upload_retention only, so a person can neither insert nor update local_compute.

create table public.local_compute_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  turned_on boolean not null,
  set_by uuid not null references auth.users (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  at timestamptz not null default now());
alter table public.local_compute_audit enable row level security;
revoke all on public.local_compute_audit from public, anon, authenticated, service_role, node_runner;

create function public.admin_set_local_compute(p_user uuid, p_on boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Say why, in a few words.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No such account.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.workers where user_id = p_user) then
    raise exception 'A worker account is not a person and cannot be a tester.' using errcode = '42501';
  end if;
  insert into public.account_settings (owner_id, local_compute) values (p_user, coalesce(p_on, false))
    on conflict (owner_id) do update set local_compute = excluded.local_compute;
  insert into public.local_compute_audit (user_id, turned_on, set_by, reason) values (p_user, coalesce(p_on, false), me, btrim(p_reason));
  return coalesce(p_on, false);
end $$;

-- ----------------------------------------------------------------------------------------- where a job runs
create type public.job_place as enum ('house', 'owner_local');
alter table public.jobs add column run_on public.job_place not null default 'house';

-- BEFORE INSERT, named so it fires AFTER jobs_quote (the ledger's price trigger; same-event triggers fire in name order).
create function ryagram_private.jobs_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.run_on := case when exists (select 1 from public.account_settings s where s.owner_id = new.owner_id and s.local_compute)
                     then 'owner_local'::public.job_place else 'house'::public.job_place end;
  if new.run_on = 'owner_local' then
    -- the columns exist only once the credits ledger is installed: set them through jsonb so this works either way
    new := jsonb_populate_record(new, jsonb_build_object('credits_quoted', 0, 'hold_id', null));
  end if;
  return new;
end $$;
create trigger jobs_run_on before insert on public.jobs for each row execute function ryagram_private.jobs_place();

create function ryagram_private.jobs_place_fixed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.run_on is distinct from old.run_on then
    raise exception 'Where a job runs is fixed when it is ordered.' using errcode = '42501';
  end if;
  if new.run_on = 'owner_local' and coalesce((to_jsonb(new) ->> 'credits_quoted')::int, 0) > 0 then
    raise exception 'A job that runs on its owner''s computer is never charged.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger jobs_run_on_fixed before update on public.jobs for each row execute function ryagram_private.jobs_place_fixed();

-- ----------------------------------------------------------------------------------------- nodes and tokens
create table public.node_devices (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique check (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code text not null unique check (user_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),   -- no 0 O 1 I (WEB 105)
  device_name text not null check (char_length(btrim(device_name)) between 1 and 60),
  owner_id uuid references auth.users (id) on delete cascade,
  approved_at timestamptz,
  denied_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes');
create table public.node_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  device_name text not null,
  access_hash text not null unique check (access_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  last_used_at timestamptz);
alter table public.node_devices enable row level security;
alter table public.node_tokens enable row level security;
revoke all on public.node_devices, public.node_tokens from public, anon, authenticated, service_role, node_runner;

create table ryagram_private.node_tx (txid bigint primary key, owner_id uuid not null, token_id uuid not null);
revoke all on ryagram_private.node_tx from public, anon, authenticated, service_role, node_runner;

-- the node asks for a code (runner side)
create function public.node_device_begin(p_device_code_hash text, p_user_code text, p_device_name text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare d public.node_devices;
begin
  insert into public.node_devices (device_code_hash, user_code, device_name) values (p_device_code_hash, p_user_code, btrim(p_device_name))
    returning * into d;
  return d.expires_at;
end $$;

-- the PERSON looks at the code in the app (WEB 105's #/device page): what the computer calls itself and when it asked.
-- Looking never approves anything.
create function public.device_request_check(p_user_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); d public.node_devices;
begin
  select * into d from public.node_devices
    where user_code = upper(btrim(p_user_code)) and approved_at is null and denied_at is null and used_at is null and expires_at > now();
  if not found then raise exception 'That code is not valid any more. Start again on your computer.' using errcode = 'PT404'; end if;
  return jsonb_build_object('device_name', d.device_name, 'asked_at', d.created_at, 'expires_at', d.expires_at);
end $$;

-- the PERSON approves or denies it (a worker login is refused by require_signed_in; a denied code can never be approved later)
create function public.device_decide(p_user_code text, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); d public.node_devices;
begin
  update public.node_devices
    set owner_id = case when p_approve then me end,
        approved_at = case when p_approve then now() end,
        denied_at = case when p_approve then null else now() end
    where user_code = upper(btrim(p_user_code)) and approved_at is null and denied_at is null and used_at is null and expires_at > now()
    returning * into d;
  if not found then raise exception 'That code is not valid any more. Start again on your computer.' using errcode = 'PT404'; end if;
  return jsonb_build_object('device_name', d.device_name, 'approved', coalesce(p_approve, false), 'token_days', 30);
end $$;

-- the node exchanges its approved code for a token, ONCE (runner side)
create function public.node_device_exchange(p_device_code_hash text, p_access_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare d public.node_devices; t public.node_tokens;
begin
  update public.node_devices set used_at = now()
    where device_code_hash = p_device_code_hash and approved_at is not null and used_at is null and expires_at > now()
    returning * into d;
  if not found then raise exception 'Not approved yet, or the code expired.' using errcode = 'PT401'; end if;
  insert into public.node_tokens (owner_id, device_name, access_hash) values (d.owner_id, d.device_name, p_access_hash) returning * into t;
  return t.expires_at;
end $$;

-- the person's own list and "Remove from this computer" (app session)
create function public.my_computers() returns table (id uuid, device_name text, created_at timestamptz, expires_at timestamptz,
                                                          revoked_at timestamptz, last_used_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.id, t.device_name, t.created_at, t.expires_at, t.revoked_at, t.last_used_at
  from public.node_tokens t where t.owner_id = ryagram_private.require_app_session() order by t.created_at desc
$$;
create function public.remove_computer(p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session();
begin
  update public.node_tokens set revoked_at = now() where id = p_token and owner_id = me and revoked_at is null;
  return found;
end $$;

-- every node_* call starts here: the person comes from the live token, never from an argument
create function ryagram_private.node_actor(p_access_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.node_tokens;
begin
  if p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Sign this computer in to Ryagram first.' using errcode = 'PT401';
  end if;
  select * into t from public.node_tokens k where k.access_hash = p_access_hash and k.revoked_at is null and k.expires_at > now();
  if not found then raise exception 'Sign this computer in to Ryagram first.' using errcode = 'PT401'; end if;
  if exists (select 1 from public.workers where user_id = t.owner_id) then
    raise exception 'A worker account is not a person.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', t.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, true);
  insert into ryagram_private.node_tx (txid, owner_id, token_id) values (txid_current(), t.owner_id, t.id)
    on conflict (txid) do update set owner_id = excluded.owner_id, token_id = excluded.token_id;
  update public.node_tokens set last_used_at = now() where id = t.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return t.owner_id;
end $$;

create function ryagram_private.in_node_tx() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ryagram_private.node_tx n where n.txid = txid_current())
$$;

-- the worker's own functions accept a node as the holder, for THIS transaction only
create or replace function ryagram_private.require_worker() returns public.workers
language plpgsql stable security definer set search_path = '' as $$
declare w public.workers;
begin
  select * into w from public.workers where user_id = auth.uid() and enabled;
  if found then return w; end if;
  if exists (select 1 from ryagram_private.node_tx n where n.txid = txid_current() and n.owner_id = auth.uid()) then
    w.user_id := auth.uid();
    w.name := 'node';
    w.enabled := true;
    return w;
  end if;
  raise exception 'Not an enabled worker.' using errcode = '42501';
end $$;

-- a node may act only on its owner's local job that it holds
create function ryagram_private.node_job(p_owner uuid, p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = p_owner and run_on = 'owner_local' and worker_user_id = p_owner;
  if not found then raise exception 'This computer does not hold that job.' using errcode = '42501'; end if;
  return j;
end $$;

-- the HOUSE claim: pipe1's claim_next_job (20261017000600) copied EXACTLY, with two changes marked by WORKER r9:
--   (1) refuses inside a node call; (2) takes only run_on = 'house', so the house worker never takes a tester's job.
create or replace function public.claim_next_job()
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  ctl public.control;
  lost public.jobs;
  j public.jobs;
begin
  if ryagram_private.in_node_tx() then
    raise exception 'A node claims with node_claim, never with the house claim.' using errcode = '42501';
  end if;
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
    where state = 'queued' and run_on = 'house' and job_type <> all (ctl.disabled_job_types)
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

-- ----------------------------------------------------------------------------------------- the node's calls (runner side)
create function public.node_claim(p_access_hash text) returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); ctl public.control; j public.jobs;
begin
  if not exists (select 1 from public.account_settings s where s.owner_id = me and s.local_compute) then
    raise exception 'This account is not set to render on its own computer.' using errcode = '42501';
  end if;
  perform ryagram_private.reap_lost_leases();          -- the same lease rules as the house: an expired local job requeues to its owner
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
      worker_id = 'node', worker_user_id = me
    where id = j.id returning * into j;
  insert into public.job_metering (job_id, attempt, owner_id, project_id, version_id, job_type, worker_user_id)
    values (j.id, j.attempt, j.owner_id, j.project_id, j.version_id, j.job_type, me)
    on conflict (job_id, attempt) do update set worker_user_id = excluded.worker_user_id;
  return next j;
end $$;

create function public.node_heartbeat(p_access_hash text, p_job_id uuid, p_progress numeric default null, p_note text default null,
                                      p_detail jsonb default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  perform ryagram_private.node_job(me, p_job_id);
  return public.heartbeat(p_job_id, p_progress, p_note, p_detail);
end $$;

create function public.node_report_state(p_access_hash text, p_job_id uuid, p_state public.job_state, p_error_code text default null,
                                         p_error_detail text default null, p_engine_commit text default null,
                                         p_engine_dirty boolean default null) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  perform ryagram_private.node_job(me, p_job_id);
  return public.report_state(p_job_id, p_state, p_error_code, p_error_detail, p_engine_commit, p_engine_dirty);
end $$;

create function public.node_retry(p_access_hash text, p_job_id uuid, p_error_code text, p_error_detail text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  perform ryagram_private.node_job(me, p_job_id);
  return public.retry_job(p_job_id, p_error_code, p_error_detail);
end $$;

create function public.node_register_artifact(p_access_hash text, p_job_id uuid, p_kind public.artifact_kind, p_bytes bigint,
                                              p_sha256 text, p_duration_s numeric default null, p_width int default null,
                                              p_height int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  perform ryagram_private.node_job(me, p_job_id);
  return public.register_artifact(p_job_id, p_kind, p_bytes, p_sha256, p_duration_s, p_width, p_height);
end $$;

-- ----------------------------------------------------------------------------------------- usage readout (Ryan 13:49)
-- Ryan chose a readout over a purge policy: Claude warns him near the Free-plan ceiling, and he deletes after Sam has
-- downloaded. Read-only, admin only; deletes nothing.
create function public.admin_storage_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage', coalesce((select jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b))
                         from (select o.bucket_id, count(*) as n, coalesce(sum((o.metadata ->> 'size')::bigint), 0) as b
                               from storage.objects o group by o.bucket_id) x), '{}'::jsonb),
    'local_jobs_outputs_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                                          join public.artifacts a on a.storage_path = o.name
                                          join public.jobs j on j.id = a.job_id where j.run_on = 'owner_local'), 0));
end $$;

-- ----------------------------------------------------------------------------------------- grants
revoke execute on function
  public.node_device_begin(text, text, text), public.node_device_exchange(text, text), public.node_claim(text),
  public.node_heartbeat(text, uuid, numeric, text, jsonb),
  public.node_report_state(text, uuid, public.job_state, text, text, text, boolean),
  public.node_retry(text, uuid, text, text),
  public.node_register_artifact(text, uuid, public.artifact_kind, bigint, text, numeric, int, int)
  from public, anon, authenticated, service_role;
grant execute on function
  public.node_device_begin(text, text, text), public.node_device_exchange(text, text), public.node_claim(text),
  public.node_heartbeat(text, uuid, numeric, text, jsonb),
  public.node_report_state(text, uuid, public.job_state, text, text, text, boolean),
  public.node_retry(text, uuid, text, text),
  public.node_register_artifact(text, uuid, public.artifact_kind, bigint, text, numeric, int, int)
  to node_runner;
revoke execute on function public.device_request_check(text), public.device_decide(text, boolean), public.my_computers(),
  public.remove_computer(uuid), public.admin_storage_usage(),
  public.admin_set_local_compute(uuid, boolean, text) from public, anon, node_runner;
grant execute on function public.device_request_check(text), public.device_decide(text, boolean), public.my_computers(),
  public.remove_computer(uuid), public.admin_storage_usage(),
  public.admin_set_local_compute(uuid, boolean, text) to authenticated;
revoke execute on function ryagram_private.node_actor(text), ryagram_private.in_node_tx(), ryagram_private.node_job(uuid, uuid),
  ryagram_private.jobs_place(), ryagram_private.jobs_place_fixed() from public, anon, authenticated, service_role, node_runner;

commit;

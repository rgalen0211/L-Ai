-- r9 M3: the render node (WORKER; was supabase/r9-drafts/r9_node_draft.sql rev5 311c92d, CC1 13:20, 13:34, 14:11).
-- Design: proposals\R9-REAL-PRODUCT-PLAN.md (CONNECT 97) and proposals\WORKER-R9-REMOTE-NODE-NOTES.md.
-- Tests: supabase/tests/test_r9_node.py (it builds the database from every OTHER migration, then applies this file).
--
-- HOW IT IS APPLIED (Ryan's step, proposals\RYAN-GO-LIVE-SESSION.md C2; proof project first, then live):
--   * BEFORE: the dated export exists (Q160), and phase-2b/credits_ledger.sql is already on the database.
--   * House claims PAUSED first: this file replaces claim_next_job, which the live worker calls every few seconds.
--     The exact pause, the wait, the read-only checks and the un-pause: proposals\WORKER-R9-BACKUP-AND-ROLLBACK.md C2.
--   * ONE transaction (begin ... commit below): it applies whole or not at all.
--   * AFTER: Ryan gives node_runner its login himself (C3; the statement is in the note below).
--   * UNDO: supabase/rollbacks/20261021000100_r9_render_node_rollback.sql, the exact reverse, also one transaction.
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

-- node_runner is created NOLOGIN here. The 'node' edge function connects AS node_runner (NODE_DB_URL), so the APPLY row
-- includes Ryan's own step, as for connect_runner: from a file OUTSIDE every repo, in the SQL Editor,
--   alter role node_runner login password '<a new random password>';
-- and that password goes only into the function's secrets. It is never in a migration, a repo, a log or a chat.
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
  was_on boolean not null,
  turned_on boolean not null,
  set_by uuid not null references auth.users (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  at timestamptz not null default now());
alter table public.local_compute_audit enable row level security;
revoke all on public.local_compute_audit from public, anon, authenticated, service_role, node_runner;

create function public.admin_set_local_compute(p_user uuid, p_on boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin(); old boolean;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'Say why, in a few words.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No such account.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.workers where user_id = p_user) then
    raise exception 'A worker account is not a person and cannot be a tester.' using errcode = '42501';
  end if;
  old := coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_user), false);
  insert into public.account_settings (owner_id, local_compute) values (p_user, coalesce(p_on, false))
    on conflict (owner_id) do update set local_compute = excluded.local_compute;
  insert into public.local_compute_audit (user_id, was_on, turned_on, set_by, reason) values (p_user, old, coalesce(p_on, false), me, btrim(p_reason));
  if not coalesce(p_on, false) then
    update public.jobs set state = 'cancelled', error_code = 'cancelled', error_class = 'cancelled', ended_at = now(),
        error_detail = 'Rendering on your own computer was switched off for this account, so this job will not run.'
      where owner_id = p_user and run_on = 'owner_local' and state = 'queued';
  end if;
  return coalesce(p_on, false);
end $$;

-- WEB 114: an admin knows an EMAIL, not an id
create function public.admin_set_local_compute_by_email(p_email text, p_on boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin(); u uuid;
begin
  select id into u from auth.users where lower(email) = lower(btrim(p_email));
  if u is null then raise exception 'No such account.' using errcode = 'PT404'; end if;
  return public.admin_set_local_compute(u, p_on, p_reason);
end $$;

-- WEB 114: the history, newest first (admin only; the table itself stays unreadable from the API)
create function public.admin_local_compute_audit() returns table (user_email text, was_on boolean, turned_on boolean,
                                                                 set_by_email text, reason text, at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select (select u.email from auth.users u where u.id = a.user_id)::text, a.was_on, a.turned_on,
                      (select u.email from auth.users u where u.id = a.set_by)::text, a.reason, a.at
               from public.local_compute_audit a order by a.at desc, a.id desc;
end $$;

-- ----------------------------------------------------------------------------------------- where a job runs
create type public.job_place as enum ('house', 'owner_local');
alter table public.jobs add column run_on public.job_place not null default 'house';
alter table public.jobs add column node_token_id uuid;   -- which signed-in computer claimed it (receipt and holder check)

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
-- Names and shapes follow CONNECT's docs/maker-signin-contract.md (RFC 8628 device authorization) and WEB 105's calls.
-- The NODE TOKEN is minted at the computer's poll, never at approval: only its sha256 is ever stored, so the one moment
-- its plaintext exists is the poll that hands it to the computer (the edge function makes it, passes the hash here, and
-- returns the plaintext once).
create table public.device_codes (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null unique check (device_hash ~ '^[0-9a-f]{64}$'),
  user_code text not null unique check (user_code ~ '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$'),   -- no 0 O 1 I L
  computer_name text not null check (char_length(btrim(computer_name)) between 1 and 60),   -- untrusted text, from the app
  state text not null default 'pending' check (state in ('pending', 'approved', 'denied', 'used')),
  user_id uuid references auth.users (id) on delete cascade,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  interval_s int not null default 5 check (interval_s between 1 and 60),
  next_poll_at timestamptz not null default now());
-- NO ip column: a rough place is not stored (CC1 13:48 point 6). If the page shows one, it comes from the live request.
create table public.node_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  computer_name text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  last_used_at timestamptz);
alter table public.device_codes enable row level security;
alter table public.node_tokens enable row level security;
revoke all on public.device_codes, public.node_tokens from public, anon, authenticated, service_role, node_runner;

create table ryagram_private.node_tx (txid bigint primary key, owner_id uuid not null, token_id uuid not null);
revoke all on ryagram_private.node_tx from public, anon, authenticated, service_role, node_runner;

-- CONNECT 100: fixed-window rate counters for the 'node' edge function (a copy of connect_anon_hit, its own table)
create table public.node_buckets (
  who text not null,
  bucket text not null,
  window_start timestamptz not null,
  n int not null default 0,
  primary key (who, bucket, window_start));
alter table public.node_buckets enable row level security;
revoke all on public.node_buckets from public, anon, authenticated, service_role, node_runner;

create function public.node_hit(p_caller text, p_bucket text, p_max int, p_window_s int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w timestamptz; c int;
begin
  if p_caller is null or p_caller !~ '^[0-9a-f]{64}$' or p_bucket !~ '^[a-z0-9_]{1,30}$' or p_window_s not between 1 and 86400 or p_max < 1 then
    raise exception 'bad limit' using errcode = '22023'; end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.node_buckets (who, bucket, window_start, n) values (p_caller, p_bucket, w, 1)
    on conflict (who, bucket, window_start) do update set n = public.node_buckets.n + 1
    returning public.node_buckets.n into c;
  return c <= p_max;
end $$;

-- a per-person fixed-window cap (the codes are 31^8, so guessing is already impractical; this closes it cheaply)
create function ryagram_private.node_user_hit(p_user uuid, p_bucket text, p_max int, p_window_s int) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz; c int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.node_buckets (who, bucket, window_start, n) values ('user:' || p_user, p_bucket, w, 1)
    on conflict (who, bucket, window_start) do update set n = public.node_buckets.n + 1
    returning public.node_buckets.n into c;
  if c > p_max then
    raise exception 'Too many tries. Wait a few minutes and try again.' using errcode = 'PT429';
  end if;
end $$;

-- MED-3: ended sign-in codes go after a day; node_tx rows of finished transactions go at once
create function ryagram_private.node_sweep() returns void
language sql security definer set search_path = '' as $$
  delete from public.device_codes where expires_at < now() - interval '1 day';
  delete from public.node_buckets where window_start < now() - interval '1 day';
  delete from ryagram_private.node_tx where txid < txid_snapshot_xmin(txid_current_snapshot());
$$;

-- the owner's email, masked: s***@example.com (enough to notice the wrong account, not to read the address)
create function ryagram_private.masked_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) from auth.users u where u.id = p_user
$$;

-- POST /device/code (runner side): the computer's secret arrives hashed; the user code is the edge function's
create function public.node_device_begin(p_device_hash text, p_user_code text, p_computer_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.device_codes;
begin
  perform ryagram_private.node_sweep();
  if (select count(*) from public.device_codes where state = 'pending' and expires_at > now()) >= 500 then
    raise exception 'Too many sign-in codes are waiting right now. Try again in a few minutes.' using errcode = 'PT429';
  end if;
  insert into public.device_codes (device_hash, user_code, computer_name)
    values (p_device_hash, p_user_code,
            btrim(regexp_replace(coalesce(p_computer_name, ''), '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g')))
    returning * into d;
  return jsonb_build_object('user_code', d.user_code, 'expires_in', 600, 'interval', d.interval_s);
end $$;

-- WEB's #/device page: what the computer calls itself and when it asked. Looking changes NOTHING.
create function public.device_request_check(p_user_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); d public.device_codes;
begin
  perform ryagram_private.node_user_hit(me, 'code_check', 60, 3600);
  select * into d from public.device_codes where user_code = upper(btrim(p_user_code));
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if d.state <> 'pending' then return jsonb_build_object('state', 'used'); end if;
  if d.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_build_object('state', 'pending', 'computer_name', d.computer_name, 'requested_at', d.created_at,
                            'rough_location', null, 'expires_at', d.expires_at);
end $$;

-- the PERSON approves or denies, ONCE (app session only; a worker login is refused by require_signed_in)
create function public.device_decide(p_user_code text, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); d public.device_codes;
begin
  perform ryagram_private.node_user_hit(me, 'code_decide', 20, 3600);
  if p_approve and not coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) then
    raise exception 'This account is not set up to render on its own computer yet.' using errcode = '42501';
  end if;
  update public.device_codes
    set state = case when p_approve then 'approved' else 'denied' end,
        user_id = case when p_approve then me end, decided_at = now()
    where user_code = upper(btrim(p_user_code)) and state = 'pending' and expires_at > now()
    returning * into d;
  if not found then raise exception 'That code is not valid any more. Start again on your computer.' using errcode = 'PT404'; end if;
  return jsonb_build_object('computer_name', d.computer_name, 'approved', coalesce(p_approve, false), 'token_days', 30);
end $$;

-- POST /device/token (runner side): the computer polls with its secret; on approval the token is minted HERE, once.
-- Returns {state} for the edge function to map: authorization_pending, slow_down, access_denied, expired_token, or ok.
create function public.node_device_exchange(p_device_hash text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.device_codes; t public.node_tokens; nxt int;
begin
  select * into d from public.device_codes where device_hash = p_device_hash for update;
  if not found or d.state = 'used' then return jsonb_build_object('state', 'expired_token'); end if;   -- once only
  if d.state = 'denied' then return jsonb_build_object('state', 'access_denied'); end if;
  if d.expires_at <= now() then return jsonb_build_object('state', 'expired_token'); end if;
  if now() < d.next_poll_at then
    nxt := least(d.interval_s + 5, 60);
    update public.device_codes set interval_s = nxt, next_poll_at = now() + make_interval(secs => nxt) where id = d.id;
    return jsonb_build_object('state', 'slow_down', 'interval', nxt);
  end if;
  update public.device_codes set next_poll_at = now() + make_interval(secs => d.interval_s) where id = d.id;
  if d.state = 'pending' then return jsonb_build_object('state', 'authorization_pending'); end if;
  update public.device_codes set state = 'used' where id = d.id;
  insert into public.node_tokens (user_id, computer_name, token_hash) values (d.user_id, d.computer_name, p_token_hash) returning * into t;
  return jsonb_build_object('state', 'ok', 'expires_in', 30 * 86400, 'account', jsonb_build_object(
    'email', ryagram_private.masked_email(d.user_id), 'computer_name', d.computer_name,
    'local_compute', coalesce((select s.local_compute from public.account_settings s where s.owner_id = d.user_id), false)));
end $$;

-- the person's own list and Remove (app session)
create function public.my_computers() returns table (id uuid, computer_name text, created_at timestamptz, expires_at timestamptz,
                                                     last_used_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.id, t.computer_name, t.created_at, t.expires_at, t.last_used_at
  from public.node_tokens t where t.user_id = ryagram_private.require_app_session() and t.revoked_at is null
  order by t.created_at desc
$$;
create function public.remove_computer(p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session();
begin
  update public.node_tokens set revoked_at = now() where id = p_token and user_id = me and revoked_at is null;
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
  select * into t from public.node_tokens k where k.token_hash = p_access_hash and k.revoked_at is null and k.expires_at > now();
  if not found then raise exception 'Sign this computer in to Ryagram first.' using errcode = 'PT401'; end if;
  if exists (select 1 from public.workers where user_id = t.user_id) then
    raise exception 'A worker account is not a person.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', t.user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);
  insert into ryagram_private.node_tx (txid, owner_id, token_id) values (txid_current(), t.user_id, t.id)
    on conflict (txid) do update set owner_id = excluded.owner_id, token_id = excluded.token_id;
  update public.node_tokens set last_used_at = now() where id = t.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return t.user_id;
end $$;

-- GET /account (runner side, bearer token): who this computer is signed in as
create function public.node_account(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); t public.node_tokens;
begin
  select * into t from public.node_tokens where token_hash = p_access_hash;
  return jsonb_build_object('account', jsonb_build_object(
    'email', ryagram_private.masked_email(me), 'computer_name', t.computer_name,
    'local_compute', coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false),
    'approved_until', t.expires_at));
end $$;

-- POST /signout (runner side, bearer token): this computer signs itself out
create function public.node_signout(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  update public.node_tokens set revoked_at = now() where token_hash = p_access_hash and revoked_at is null;
  return jsonb_build_object('ok', true);
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
  if not found and exists (select 1 from ryagram_private.node_tx n                                   -- WORKER r9
                           where n.txid = txid_current() and n.owner_id = auth.uid()) then           -- WORKER r9
    w.user_id := auth.uid(); w.name := 'node'; w.enabled := true;                                   -- WORKER r9
    return w;                                                                                         -- WORKER r9
  end if;                                                                                             -- WORKER r9
  if not found then
    raise exception 'Not an enabled worker.' using errcode = '42501';
  end if;
  return w;
end $$;

-- a node may act only on its owner's local job that it holds
create function ryagram_private.node_job(p_owner uuid, p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = p_owner and run_on = 'owner_local' and worker_user_id = p_owner
    and node_token_id = (select n.token_id from ryagram_private.node_tx n where n.txid = txid_current());
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
declare me uuid := ryagram_private.node_actor(p_access_hash); bad text;
begin
  perform ryagram_private.node_job(me, p_job_id);
  if p_state = 'complete' then
    -- a signed upload URL does not hold an upload to the size the node CLAIMED: compare what is stored (storage keeps the
    -- size; it keeps no sha256, so the hash is the file's own receipt's job, not checkable here)
    select string_agg(a.kind::text, ', ') into bad from public.artifacts a
      left join storage.objects o on o.bucket_id = a.bucket and o.name = a.storage_path
      where a.job_id = p_job_id and (o.name is null or coalesce((o.metadata ->> 'size')::bigint, -1) <> a.bytes);
    if bad is not null then
      raise exception 'The stored file is not the size this computer registered (%): not completed.', bad using errcode = '42501';
    end if;
  end if;
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
  public.node_device_begin(text, text, text), public.node_device_exchange(text, text), public.node_account(text),
  public.node_hit(text, text, int, int),
  public.node_signout(text), public.node_claim(text),
  public.node_heartbeat(text, uuid, numeric, text, jsonb),
  public.node_report_state(text, uuid, public.job_state, text, text, text, boolean),
  public.node_retry(text, uuid, text, text),
  public.node_register_artifact(text, uuid, public.artifact_kind, bigint, text, numeric, int, int)
  from public, anon, authenticated, service_role;
grant execute on function
  public.node_device_begin(text, text, text), public.node_device_exchange(text, text), public.node_account(text),
  public.node_hit(text, text, int, int),
  public.node_signout(text), public.node_claim(text),
  public.node_heartbeat(text, uuid, numeric, text, jsonb),
  public.node_report_state(text, uuid, public.job_state, text, text, text, boolean),
  public.node_retry(text, uuid, text, text),
  public.node_register_artifact(text, uuid, public.artifact_kind, bigint, text, numeric, int, int)
  to node_runner;
revoke execute on function public.device_request_check(text), public.device_decide(text, boolean), public.my_computers(),
  public.remove_computer(uuid), public.admin_storage_usage(), public.admin_set_local_compute_by_email(text, boolean, text),
  public.admin_local_compute_audit(),
  public.admin_set_local_compute(uuid, boolean, text) from public, anon, node_runner;
grant execute on function public.device_request_check(text), public.device_decide(text, boolean), public.my_computers(),
  public.remove_computer(uuid), public.admin_storage_usage(), public.admin_set_local_compute_by_email(text, boolean, text),
  public.admin_local_compute_audit(),
  public.admin_set_local_compute(uuid, boolean, text) to authenticated;
revoke execute on function ryagram_private.node_actor(text), ryagram_private.in_node_tx(), ryagram_private.node_job(uuid, uuid),
  ryagram_private.node_sweep(), ryagram_private.masked_email(uuid), ryagram_private.node_user_hit(uuid, text, int, int),
  ryagram_private.jobs_place(), ryagram_private.jobs_place_fixed() from public, anon, authenticated, service_role, node_runner;

commit;

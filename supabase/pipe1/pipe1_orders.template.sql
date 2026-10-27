-- PIPE-1, step 2 of 2: render orders -- story JSON to a delivered link with no hand steps.
-- Implements JOB-CONTRACT-v1 (proposals\JOB-CONTRACT-v1.md, frozen by CC1 2026-10-17 15:57,
-- sha256 eedfe74a5778e3234e2a8cd6326b55e079b99220be16ef5f448ee833fdeebf94). Author: WORKER.
--
-- APPLY AFTER 20261017000500_pipe1_job_state.sql HAS COMMITTED (a new enum value can't be used in the transaction that
-- added it), after phase-2b/credits_ledger.sql (holds, captures, releases are its triggers on public.jobs), and after
-- 20261010000100_ops_readiness.sql (ops_settings, is_app_admin, admin_ops). One transaction.
--
-- No new runner, no second job schema: every rendering stage is a public.jobs row claimed by the existing PC worker.
-- Functions carried over from earlier files are their LATEST definitions with small marked edits, built by
-- supabase/pipe1/build_pipe1.py (each edit asserted to match exactly; rerun it to check this file is what it builds).
-- The story schema is Ryagram ryagram/worker/story.schema.json at main 3dbfa50 (copied to supabase/pipe1/).
--
-- WHAT CHANGES FOR EXISTING THINGS
--   * jobs.attempt: 1..2 (retry once, Ryan). The constraint is NOT VALID, so finished jobs from before keep attempt 3.
--   * claim_next_job / retry_job / ops_tick's reap_lost_leases: a lost or retried attempt is re-queued only while attempt < 2.
--   * submit_job: unchanged for callers; its body moves to ryagram_private.submit_job_for(owner, ...).
--   * cancel_job: a final awaiting approval can be cancelled (its hold is released).
--   * a final awaiting approval counts as work in progress for submit_job, account and dataset deletion.
--   * sync_version_state: awaiting_approval keeps its version 'queued'.
--   * admin_ops(): the old function moves to ryagram_private.admin_ops_base(); the new one adds the 'orders' block.

begin;

-- ---------------------------------------------------------------- types and tables (contract section 2)

create type public.order_want   as enum ('preview', 'final');
create type public.order_source as enum ('app', 'connect');
create type public.order_state  as enum ('running', 'awaiting_approval', 'delivered', 'previewed',
                                         'editorial_action_required', 'failed', 'declined', 'cancelled', 'expired');
create type public.render_stage as enum ('validate', 'preflight', 'contact_sheet', 'preview', 'final_render', 'deliver');
create type public.stage_state  as enum ('waiting', 'queued', 'running', 'complete', 'failed', 'awaiting_approval',
                                         'declined', 'capped', 'cancelled', 'expired', 'skipped',
                                         'editorial_action_required');

create table public.render_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  source public.order_source not null,
  want public.order_want not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  story_sha256 text not null check (story_sha256 ~ '^[0-9a-f]{64}$'),
  state public.order_state not null default 'running',
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (owner_id, idempotency_key)                -- a key is spent for good, whatever happens to its order
);
create index render_orders_owner_idx on public.render_orders (owner_id, created_at desc);

create table public.render_stages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.render_orders (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  stage public.render_stage not null,
  idempotency_key text not null,                  -- '<order key>:<stage>'
  state public.stage_state not null default 'waiting',
  job_id uuid references public.jobs (id) on delete restrict,   -- one job per stage; see the index below
  credits_quoted int not null default 0 check (credits_quoted >= 0),
  awaiting_since timestamptz,
  admin_decided_by uuid, admin_decided_at timestamptz,
  admin_note text check (char_length(admin_note) <= 500),
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(), ended_at timestamptz,
  unique (order_id, stage), unique (owner_id, idempotency_key)
);
create index render_stages_waiting_idx on public.render_stages (awaiting_since) where state = 'awaiting_approval';
-- A job belongs to ONE order's own stage. An order made from an existing finished sheet and preview (request_final) only
-- REFERS to them ('<key>:<stage>:adopted'), so a new request may adopt the same preview after a failed, declined or
-- expired one (the app could always retry a failed final). CC1 review of d27146e.
create unique index render_stages_job_once on public.render_stages (job_id)
  where job_id is not null and idempotency_key not like '%:adopted';

create table public.render_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.render_orders (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  artifact_id uuid not null references public.artifacts (id) on delete restrict,
  label text not null default 'AI-assisted' check (label = 'AI-assisted'),
  visibility text not null default 'private' check (visibility = 'private'),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index render_deliveries_expiry_idx on public.render_deliveries (expires_at) where deleted_at is null;

alter table public.ops_settings
  add column auto_render boolean not null default false,             -- Ryan: OFF by default
  add column default_credits_per_day int not null default 20 check (default_credits_per_day >= 0),
  add column approval_days int not null default 7 check (approval_days between 1 and 30),
  add column delivery_days int not null default 30 check (delivery_days between 1 and 365),
  add column storage_budget_mb int not null default 800 check (storage_budget_mb > 0);

create table public.user_caps (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  credits_per_day int not null check (credits_per_day >= 0),
  updated_by uuid not null, updated_at timestamptz not null default now()
);

alter table public.jobs add column stage_id uuid unique references public.render_stages (id) on delete restrict;
alter table public.jobs drop constraint jobs_attempt_check;
alter table public.jobs add constraint jobs_attempt_check check (attempt between 1 and 2) not valid;

-- The worker's story schema (Ryagram ryagram/worker/story.schema.json), for the validate stage when pg_jsonschema is on.
create table public.story_schemas (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  schema jsonb not null,
  loaded_at timestamptz not null default now()
);
insert into public.story_schemas (sha256, schema) values ('{{STORY_SCHEMA_SHA256}}', $story${{STORY_SCHEMA_JSON}}$story$::jsonb);

-- ---------------------------------------------------------------- carried-over functions (edited; see the header)

{{SYNC_VERSION_STATE}}

{{SUBMIT_JOB_FOR}}

-- The app's direct path (CC1 review of d27146e, HIGH): while auto_render is OFF a full render is REFUSED here, so the
-- app's Render button can't skip Ryan's queue; it calls request_final_render, which queues the render for his approval
-- with its credits held. With auto_render ON the direct path works as before. Every paid job checks the daily cap.
create or replace function public.submit_job(
  p_version_id uuid,
  p_job_type public.job_type,
  p_params jsonb default '{}'::jsonb,
  p_sheet_job_id uuid default null,
  p_preview_job_id uuid default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  j public.jobs;
begin
  if p_job_type = 'final_render' and not (select auto_render from public.ops_settings where id) then
    raise exception 'Full renders are approved before they start: use request_final_render, which queues this one for approval with its credits held.'
      using errcode = '42501';
  end if;
  j := ryagram_private.submit_job_for(me, p_version_id, p_job_type, p_params, p_sheet_job_id, p_preview_job_id);
  if coalesce((to_jsonb(j) ->> 'credits_quoted')::int, 0) > 0
     and ryagram_private.credits_last_24h(me) > ryagram_private.daily_cap(me) then
    raise exception 'daily_cap: you have reached today''s credit limit. Try again tomorrow.' using errcode = 'PTCAP';
  end if;
  return j;
end $$;

{{CANCEL_JOB}}

{{ACCOUNT_DELETION_CHECK}}

{{REQUEST_DATASET_DELETION}}

{{CLAIM_NEXT_JOB}}

{{REAP_LOST_LEASES}}

{{RETRY_JOB}}

-- ---------------------------------------------------------------- helpers

-- App-session functions refuse a CONNECT OAuth token (it carries client_id; an app session does not; CONNECT-DESIGN 60/62).
create function ryagram_private.require_app_session() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'A connected AI uses its own tools for this.' using errcode = '42501';
  end if;
  return me;
end $$;

-- Credits the owner has committed in the last 24 h: holds not released (pending or captured). plpgsql: the ledger may be
-- applied after this file in a fresh database.
create function ryagram_private.credits_last_24h(p_owner uuid, p_exclude_job uuid default null) returns int
language plpgsql stable security definer set search_path = '' as $$
declare n int;
begin
  if to_regclass('public.credit_ledger') is null then
    return 0;
  end if;
  execute 'select coalesce(-sum(h.amount), 0)::int from public.credit_ledger h
           where h.owner_id = $1 and h.entry = ''hold'' and h.created_at > now() - interval ''24 hours''
             and ($2 is null or h.job_id <> $2)
             and not exists (select 1 from public.credit_ledger r where r.resolves_id = h.id and r.entry = ''release'')'
    into n using p_owner, p_exclude_job;
  return n;
end $$;

create function ryagram_private.daily_cap(p_owner uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select credits_per_day from public.user_caps where owner_id = p_owner),
                  (select default_credits_per_day from public.ops_settings where id))
$$;

create function ryagram_private.stage_for_job(p public.job_state) returns public.stage_state
language sql immutable set search_path = '' as $$
  select case p
    when 'queued' then 'queued' when 'awaiting_approval' then 'awaiting_approval'
    when 'claimed' then 'running' when 'running' then 'running' when 'validating' then 'running' when 'uploading' then 'running'
    when 'complete' then 'complete' when 'failed' then 'failed' when 'cancelled' then 'cancelled'
    when 'editorial_action_required' then 'editorial_action_required' end::public.stage_state
$$;

create function ryagram_private.order_stage(p_order public.render_orders, p_stage public.render_stage,
                                            p_state public.stage_state default 'waiting', p_job uuid default null)
returns public.render_stages
language plpgsql security definer set search_path = '' as $$
declare s public.render_stages;
begin
  insert into public.render_stages (order_id, owner_id, stage, idempotency_key, state, job_id, ended_at)
    values (p_order.id, p_order.owner_id, p_stage, p_order.idempotency_key || ':' || p_stage, p_state, p_job,
            case when p_state in ('complete', 'failed', 'skipped') then now() end)
    on conflict (order_id, stage) do nothing;
  select * into s from public.render_stages where order_id = p_order.id and stage = p_stage;
  return s;
end $$;

-- Ends an order: its state, its error, and every stage not yet started marked skipped.
create function ryagram_private.order_end(p_order uuid, p_state public.order_state, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.render_orders set state = p_state, error_code = coalesce(p_error, error_code),
      ended_at = case when p_state in ('running', 'awaiting_approval') then null else now() end
    where id = p_order;
  if p_state not in ('running', 'awaiting_approval') then
    update public.render_stages set state = 'skipped', ended_at = now()
      where order_id = p_order and state = 'waiting';
  end if;
end $$;

-- Submits a stage's job. The daily cap and a short balance are handled HERE, in a sub-block: the job is inserted (the 2B
-- triggers quote and hold it), then the owner's last 24 h is checked WITH that hold; over the cap, the block rolls back to
-- its start -- no job, no hold -- and the stage is 'capped'. Not enough credits (2B raises 53400): no job, no hold.
create function ryagram_private.stage_submit(p_order public.render_orders, p_stage public.render_stages,
                                             p_type public.job_type, p_params jsonb, p_sheet uuid, p_preview uuid,
                                             p_hold boolean default false)
returns public.render_stages
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  s public.render_stages := p_stage;
  quoted int;
begin
  begin
    j := ryagram_private.submit_job_for(p_order.owner_id, p_order.version_id, p_type, coalesce(p_params, '{}'::jsonb),
                                        p_sheet, p_preview,
                                        case when p_hold then 'awaiting_approval' else 'queued' end::public.job_state, s.id);
    quoted := coalesce((to_jsonb(j) ->> 'credits_quoted')::int, 0);
    if quoted > 0 and ryagram_private.credits_last_24h(p_order.owner_id) > ryagram_private.daily_cap(p_order.owner_id) then
      raise exception 'daily_cap' using errcode = 'PTCAP';
    end if;
  exception
    when sqlstate 'PTCAP' then
      update public.render_stages set state = 'capped', error_code = 'daily_cap', ended_at = now()
        where id = s.id returning * into s;
      perform ryagram_private.order_end(p_order.id, 'failed', 'daily_cap');
      return s;
    when sqlstate '53400' then
      update public.render_stages set state = 'failed', error_code = 'insufficient_credits', ended_at = now()
        where id = s.id returning * into s;
      perform ryagram_private.order_end(p_order.id, 'failed', 'insufficient_credits');
      return s;
  end;
  update public.render_stages set job_id = j.id, state = ryagram_private.stage_for_job(j.state), credits_quoted = quoted,
      awaiting_since = case when p_hold then now() end
    where id = s.id returning * into s;
  return s;
end $$;

-- The validate stage: the shape check every job gets, plus the worker's JSON Schema when pg_jsonschema is enabled.
-- Returns null when the story passes, else a short reason. The worker re-checks the full schema before every render.
create function ryagram_private.story_problem(p_story jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if p_story is null or jsonb_typeof(p_story) <> 'object' then
    return 'The story must be a JSON object.';
  end if;
  if pg_column_size(p_story) > 262144 then
    return 'The story is larger than 256 KB.';
  end if;
  if (p_story ->> 'schema' = '1' and p_story ->> 'engine' = 'sequence') is not true then
    return 'The story is not a schema-1 sequence.';
  end if;
  if to_regprocedure('extensions.json_matches_schema(json, json)') is not null then
    execute 'select extensions.json_matches_schema($1::json, $2::json)'
      into ok using (select schema from public.story_schemas order by loaded_at desc limit 1), p_story;
    if not ok then
      return 'The story does not match the story schema.';
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- the order machine (contract section 4)

create function ryagram_private.advance_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.render_orders;
  st record;
  sh public.render_stages;
  pv public.render_stages;
  fn public.render_stages;
  j public.jobs;
  art uuid;
  n_days int;
begin
  select * into o from public.render_orders where id = p_order for update;
  if not found or o.state not in ('running', 'awaiting_approval') then
    return;
  end if;
  -- every stage with a job mirrors its job
  for st in select s.id, j2.state as job_state from public.render_stages s join public.jobs j2 on j2.id = s.job_id
            where s.order_id = o.id and s.state not in ('declined', 'expired', 'capped', 'skipped') loop
    update public.render_stages set state = ryagram_private.stage_for_job(st.job_state),
        ended_at = case when st.job_state in ('complete', 'failed', 'cancelled', 'editorial_action_required') then coalesce(ended_at, now()) end
      where id = st.id;
  end loop;

  -- contact sheet (preflight runs inside it)
  sh := ryagram_private.order_stage(o, 'contact_sheet');
  if sh.job_id is null and sh.state = 'waiting' then
    sh := ryagram_private.stage_submit(o, sh, 'contact_sheet', '{}'::jsonb, null, null);
    return;
  end if;
  if sh.state in ('queued', 'running') then return; end if;
  if sh.state = 'editorial_action_required' then
    update public.render_stages set state = 'editorial_action_required', ended_at = now(), error_code = 'gate'
      where order_id = o.id and stage = 'preflight';
    perform ryagram_private.order_end(o.id, 'editorial_action_required', 'gate');
    return;
  end if;
  if sh.state <> 'complete' then
    select * into j from public.jobs where id = sh.job_id;
    perform ryagram_private.order_end(o.id, 'failed', coalesce(j.error_code, 'contact_sheet_' || sh.state));
    return;
  end if;
  update public.render_stages set state = 'complete', ended_at = coalesce(ended_at, now())
    where order_id = o.id and stage = 'preflight' and state <> 'complete';

  -- preview, 10 s
  pv := ryagram_private.order_stage(o, 'preview');
  if pv.job_id is null and pv.state = 'waiting' then
    pv := ryagram_private.stage_submit(o, pv, 'preview', jsonb_build_object('window_s', jsonb_build_array(0, 10)), null, null);
    return;
  end if;
  if pv.state in ('queued', 'running') then return; end if;
  if pv.state <> 'complete' then
    select * into j from public.jobs where id = pv.job_id;
    perform ryagram_private.order_end(o.id, (case when pv.state = 'editorial_action_required' then 'editorial_action_required' else 'failed' end)::public.order_state,
                                      coalesce(j.error_code, 'preview_' || pv.state));
    return;
  end if;
  if o.want = 'preview' then
    perform ryagram_private.order_end(o.id, 'previewed');
    return;
  end if;

  -- full render: queued at once with auto_render, else HELD for Ryan's approval (the hold is placed now)
  fn := ryagram_private.order_stage(o, 'final_render');
  if fn.job_id is null and fn.state = 'waiting' then
    fn := ryagram_private.stage_submit(o, fn, 'final_render', '{}'::jsonb, sh.job_id, pv.job_id,
                                       not (select auto_render from public.ops_settings where id));
    if fn.state = 'awaiting_approval' then
      perform ryagram_private.order_end(o.id, 'awaiting_approval');
    end if;
    return;
  end if;
  if fn.state in ('queued', 'running', 'awaiting_approval') then
    if fn.state <> 'awaiting_approval' and o.state = 'awaiting_approval' then
      perform ryagram_private.order_end(o.id, 'running');
    end if;
    return;
  end if;
  if fn.state <> 'complete' then
    select * into j from public.jobs where id = fn.job_id;
    perform ryagram_private.order_end(o.id, (case when fn.state = 'editorial_action_required' then 'editorial_action_required' else 'failed' end)::public.order_state,
                                      coalesce(j.error_code, 'final_' || fn.state));
    return;
  end if;

  -- deliver: the final video, private, labelled AI-assisted, kept delivery_days
  if exists (select 1 from public.render_deliveries where order_id = o.id) then
    return;
  end if;
  select a.id into art from public.artifacts a
    where a.job_id = fn.job_id and a.kind = 'final_video' and a.deleted_at is null
    order by a.created_at desc limit 1;
  if art is null then
    -- captured but nothing to hand over: give the credits back once (2B refund_job: unique per capture)
    if to_regprocedure('public.refund_job(uuid, text, text)') is not null then
      execute 'select public.refund_job($1, $2, $3)' using fn.job_id, 'Full render finished without a film to deliver', 'system';
    end if;
    perform ryagram_private.order_stage(o, 'deliver', 'failed');
    perform ryagram_private.order_end(o.id, 'failed', 'delivery_failed');
    return;
  end if;
  select delivery_days into n_days from public.ops_settings where id;
  insert into public.render_deliveries (order_id, owner_id, artifact_id, expires_at)
    values (o.id, o.owner_id, art, now() + make_interval(days => n_days));
  perform ryagram_private.order_stage(o, 'deliver', 'complete');
  perform ryagram_private.order_end(o.id, 'delivered');
end $$;

-- After the 2B settle trigger (triggers fire in name order: jobs_settle < jobs_z_advance_order), so a capture exists before
-- delivery. A fault in an order's bookkeeping never breaks the worker's own state report: the order is marked failed instead.
create function ryagram_private.jobs_advance_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare oid uuid;
begin
  if new.stage_id is null or new.state = old.state then
    return null;
  end if;
  select order_id into oid from public.render_stages where id = new.stage_id;
  begin
    perform ryagram_private.advance_order(oid);
  exception when others then
    update public.render_orders set state = 'failed', error_code = 'advance_error', ended_at = now()
      where id = oid and state in ('running', 'awaiting_approval');
    raise warning 'advance_order % failed: % %', oid, sqlstate, sqlerrm;
  end;
  return null;
end $$;
create trigger jobs_z_advance_order after update of state on public.jobs
  for each row execute function ryagram_private.jobs_advance_order();

-- ---------------------------------------------------------------- internal entry points (contract 3a)

create function ryagram_private.order_submit(p_owner uuid, p_story jsonb, p_key text, p_want public.order_want,
                                             p_title text, p_source public.order_source)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.render_orders;
  sha text := encode(sha256(convert_to(p_story::text, 'UTF8')), 'hex');
  prob text;
  pid uuid;
  vid uuid;
  t text;
begin
  if p_owner is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'The idempotency key must be 8 to 100 letters, digits, - or _.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('render_order:' || p_owner::text || ':' || p_key));
  select * into o from public.render_orders where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if o.story_sha256 <> sha or exists (select 1 from public.render_stages s where s.order_id = o.id and s.stage = 'preview'
                                          and s.job_id is not null and s.idempotency_key like '%:adopted') then
      raise exception 'key_reused: this key belongs to another request; use a new key.' using errcode = '22023';
    end if;
    return o;                                          -- whatever its state: no new rows, no new holds
  end if;
  t := left(coalesce(nullif(btrim(p_title), ''), nullif(btrim(p_story ->> 'name'), ''), 'Untitled film'), 200);
  insert into public.projects (owner_id, title) values (p_owner, t) returning id into pid;
  insert into public.versions (owner_id, project_id, number, story_spec)
    values (p_owner, pid, 1, case when jsonb_typeof(p_story) = 'object' and pg_column_size(p_story) <= 262144 then p_story else '{}'::jsonb end)
    returning id into vid;
  insert into public.render_orders (owner_id, idempotency_key, source, want, project_id, version_id, story_sha256)
    values (p_owner, p_key, p_source, p_want, pid, vid, sha)
    returning * into o;
  prob := ryagram_private.story_problem(p_story);
  if prob is not null then
    perform ryagram_private.order_stage(o, 'validate', 'failed');
    update public.render_stages set error_code = 'invalid_story' where order_id = o.id and stage = 'validate';
    perform ryagram_private.order_end(o.id, 'failed', 'invalid_story');
  else
    perform ryagram_private.order_stage(o, 'validate', 'complete');
    perform ryagram_private.order_stage(o, 'preflight');
    perform ryagram_private.advance_order(o.id);
  end if;
  select * into o from public.render_orders where id = o.id;
  return o;
end $$;

-- For a person (or a connected AI) who made the contact sheet and preview stage by stage: an order for the full render that
-- adopts them. Refused unless both are the owner's, complete, for the same story and engine (the 2A ladder rule).
create function ryagram_private.order_request_final(p_owner uuid, p_preview_job uuid, p_key text,
                                                    p_source public.order_source)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.render_orders;
  p public.jobs;
  s public.jobs;
begin
  if p_owner is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'The idempotency key must be 8 to 100 letters, digits, - or _.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('render_order:' || p_owner::text || ':' || p_key));
  select * into o from public.render_orders where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if not exists (select 1 from public.render_stages where order_id = o.id and stage = 'preview' and job_id = p_preview_job) then
      raise exception 'key_reused: this key belongs to another request; use a new key.' using errcode = '22023';
    end if;
    return o;
  end if;
  select * into p from public.jobs where id = p_preview_job and owner_id = p_owner and job_type = 'preview' and state = 'complete';
  if not found then
    raise exception 'That preview is not yours, or not finished.' using errcode = '22023';
  end if;
  if exists (select 1 from public.render_stages rs join public.render_orders r on r.id = rs.order_id
             where rs.job_id = p.id and rs.stage = 'preview' and r.state in ('running', 'awaiting_approval', 'delivered')) then
    raise exception 'That preview already has a full-render request waiting, running or delivered.' using errcode = '42501';
  end if;
  select * into s from public.jobs
    where owner_id = p_owner and version_id = p.version_id and job_type = 'contact_sheet' and state = 'complete'
      and story_sha256 = p.story_sha256
    order by ended_at desc nulls last limit 1;
  if not found then
    raise exception 'That preview has no finished contact sheet for the same story.' using errcode = '22023';
  end if;
  insert into public.render_orders (owner_id, idempotency_key, source, want, project_id, version_id, story_sha256)
    values (p_owner, p_key, p_source, 'final', p.project_id, p.version_id, p.story_sha256)
    returning * into o;
  perform ryagram_private.order_stage(o, 'validate', 'complete');
  perform ryagram_private.order_stage(o, 'preflight', 'complete');
  perform ryagram_private.order_stage(o, 'contact_sheet', 'complete', s.id);
  perform ryagram_private.order_stage(o, 'preview', 'complete', p.id);
  update public.render_stages set idempotency_key = idempotency_key || ':adopted'
    where order_id = o.id and stage in ('contact_sheet', 'preview');
  perform ryagram_private.advance_order(o.id);
  select * into o from public.render_orders where id = o.id;
  return o;
end $$;

create function ryagram_private.order_status(p_owner uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  o public.render_orders;
  d public.render_deliveries;
begin
  select * into o from public.render_orders where id = p_order and owner_id = p_owner;
  if not found then
    raise exception 'Order not found.' using errcode = 'PT404';
  end if;
  select * into d from public.render_deliveries where order_id = o.id;
  return jsonb_build_object(
    'id', o.id, 'state', o.state, 'want', o.want, 'source', o.source, 'error_code', o.error_code,
    'created_at', o.created_at, 'ended_at', o.ended_at, 'project_id', o.project_id, 'version_id', o.version_id,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'state', s.state, 'credits_quoted', s.credits_quoted,
                                                           'error_code', s.error_code, 'job_id', s.job_id) order by s.stage)
                         from public.render_stages s where s.order_id = o.id), '[]'::jsonb),
    'delivery', case when d.id is null then null else jsonb_build_object(
      'id', d.id, 'label', d.label, 'expires_at', d.expires_at, 'deleted', d.deleted_at is not null,
      'link', 'https://uselai.com/app/#/delivery/' || d.id) end);
end $$;

create function ryagram_private.order_cancel(p_owner uuid, p_order uuid) returns public.render_orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.render_orders;
  s record;
begin
  select * into o from public.render_orders where id = p_order and owner_id = p_owner for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'PT404';
  end if;
  if o.state not in ('running', 'awaiting_approval') then
    return o;                                          -- already finished: nothing to cancel
  end if;
  perform ryagram_private.order_end(o.id, 'cancelled', 'cancelled');   -- first, so the advance trigger leaves it alone
  for s in select st.id, st.job_id, j.state from public.render_stages st left join public.jobs j on j.id = st.job_id
           where st.order_id = o.id loop
    if s.job_id is null then
      continue;
    elsif s.state in ('queued', 'awaiting_approval') then
      update public.jobs set state = 'cancelled', ended_at = now(), error_class = 'cancelled', error_code = 'cancelled'
        where id = s.job_id;                           -- the 2B trigger releases its hold in full
      update public.render_stages set state = 'cancelled', ended_at = now() where id = s.id;
    elsif s.state in ('claimed', 'running', 'validating', 'uploading') then
      update public.jobs set cancel_requested = true where id = s.job_id;
    end if;
  end loop;
  select * into o from public.render_orders where id = o.id;
  return o;
end $$;

-- The storage object behind a delivery, for the get-delivery-url Edge Function only (service_role): it signs a 1-hour URL.
-- SQL cannot sign storage URLs; the owner check, the expiry and the deletion are enforced HERE.
create function ryagram_private.delivery_object(p_owner uuid, p_delivery uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.render_deliveries;
  path text;
begin
  select * into d from public.render_deliveries where id = p_delivery and owner_id = p_owner;
  if not found then
    raise exception 'Delivery not found.' using errcode = 'PT404';
  end if;
  if d.deleted_at is not null or d.expires_at < now() then
    raise exception 'This film was kept for its 30 days and has been deleted.' using errcode = '42501';
  end if;
  select storage_path into path from public.artifacts where id = d.artifact_id and deleted_at is null;
  if path is null then
    raise exception 'This film is no longer stored.' using errcode = '42501';
  end if;
  return path;
end $$;

-- ---------------------------------------------------------------- app-session functions (contract 3b)

create function public.submit_render_order(p_story jsonb, p_idempotency_key text, p_want public.order_want,
                                           p_title text default null)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  return ryagram_private.order_submit(ryagram_private.require_app_session(), p_story, p_idempotency_key, p_want, p_title, 'app');
end $$;

create function public.request_final_render(p_preview_job uuid, p_idempotency_key text) returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  return ryagram_private.order_request_final(ryagram_private.require_app_session(), p_preview_job, p_idempotency_key, 'app');
end $$;

create function public.render_order_status(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return ryagram_private.order_status(ryagram_private.require_app_session(), p_order);
end $$;

create function public.cancel_render_order(p_order uuid) returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  return ryagram_private.order_cancel(ryagram_private.require_app_session(), p_order);
end $$;

-- Called by the get-delivery-url Edge Function with the person's own JWT forwarded; returns the object path to that
-- function only (it is not granted to authenticated).
create function public.delivery_object_for(p_owner uuid, p_delivery uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return ryagram_private.delivery_object(p_owner, p_delivery);
end $$;

-- ---------------------------------------------------------------- admin (contract 3e; WEB's names)

create function ryagram_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ryagram_private.require_app_session();       -- an admin acts from the app, never through a connected AI
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can do this.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create function public.admin_set_auto_render(p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform ryagram_private.require_admin();
  update public.ops_settings set auto_render = coalesce(p_on, false) where id;
  return coalesce(p_on, false);
end $$;

create function public.admin_render_queue()
returns table (stage_id uuid, order_id uuid, owner_id uuid, owner_email text, film_title text, credits_held int,
               requested_at timestamptz, expires_at timestamptz, source public.order_source)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ryagram_private.require_admin();
  return query
    select s.id, o.id, o.owner_id, u.email::text, p.title, s.credits_quoted, s.awaiting_since,
           s.awaiting_since + make_interval(days => (select approval_days from public.ops_settings where id)), o.source
    from public.render_stages s
    join public.render_orders o on o.id = s.order_id
    join public.projects p on p.id = o.project_id
    left join auth.users u on u.id = o.owner_id
    where s.stage = 'final_render' and s.state = 'awaiting_approval'
    order by s.awaiting_since;
end $$;

-- Ends a waiting final without rendering it: declined by Ryan, or expired after approval_days. The hold is released in
-- full by the 2B trigger when the job goes 'cancelled'.
create function ryagram_private.final_close(p_stage uuid, p_state public.stage_state, p_error text, p_by uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.render_stages;
begin
  select * into s from public.render_stages where id = p_stage for update;
  perform ryagram_private.order_end(s.order_id, (case when p_state = 'declined' then 'declined' else 'expired' end)::public.order_state, p_error);
  update public.render_stages set state = p_state, error_code = p_error, ended_at = now(),
      admin_decided_by = p_by, admin_decided_at = case when p_by is not null then now() end, admin_note = left(p_note, 500)
    where id = s.id;
  update public.jobs set state = 'cancelled', ended_at = now(), error_class = 'cancelled', error_code = p_error
    where id = s.job_id and state = 'awaiting_approval';
end $$;

create function public.admin_render_decide(p_stage uuid, p_approve boolean, p_note text default null)
returns public.render_stages
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_admin();
  s public.render_stages;
  o public.render_orders;
begin
  select * into s from public.render_stages where id = p_stage and stage = 'final_render' for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'PT404';
  end if;
  if s.state <> 'awaiting_approval' then
    raise exception 'This request is no longer waiting (%).', s.state using errcode = '42501';
  end if;
  select * into o from public.render_orders where id = s.order_id for update;
  if p_approve then
    -- the cap again, counting this job's quote once (its hold may be older than 24 h)
    if ryagram_private.credits_last_24h(o.owner_id, s.job_id) + s.credits_quoted > ryagram_private.daily_cap(o.owner_id) then
      raise exception 'daily_cap: this person has reached their daily credit cap; approve later or decline.' using errcode = 'PTCAP';
    end if;
    update public.render_stages set admin_decided_by = me, admin_decided_at = now(), admin_note = left(p_note, 500)
      where id = s.id;
    perform ryagram_private.order_end(o.id, 'running');
    update public.jobs set state = 'queued', queued_at = now() where id = s.job_id and state = 'awaiting_approval';
  else
    perform ryagram_private.final_close(s.id, 'declined', 'declined', me, p_note);
  end if;
  select * into s from public.render_stages where id = p_stage;
  return s;
end $$;

create function public.admin_user_caps()
returns table (owner_id uuid, email text, credits_per_day int, updated_at timestamptz, used_last_24h int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ryagram_private.require_admin();
  return query
    select c.owner_id, u.email::text, c.credits_per_day, c.updated_at, ryagram_private.credits_last_24h(c.owner_id)
    from public.user_caps c left join auth.users u on u.id = c.owner_id
    order by u.email;
end $$;

create function public.admin_set_user_cap(p_owner uuid, p_credits_per_day int) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  if p_credits_per_day is null then
    delete from public.user_caps where owner_id = p_owner;           -- the default applies again
  elsif p_credits_per_day < 0 then
    raise exception 'A cap is 0 or more credits a day.' using errcode = '22023';
  else
    insert into public.user_caps (owner_id, credits_per_day, updated_by) values (p_owner, p_credits_per_day, me)
      on conflict (owner_id) do update set credits_per_day = excluded.credits_per_day, updated_by = me, updated_at = now();
  end if;
end $$;

-- admin_ops(): the 2A/ops function as it was, plus the order block (contract 3e).
alter function public.admin_ops() set schema ryagram_private;
alter function ryagram_private.admin_ops() rename to admin_ops_base;

create function public.admin_ops() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return ryagram_private.admin_ops_base() || jsonb_build_object('orders', jsonb_build_object(
    'auto_render', (select auto_render from public.ops_settings where id),
    'default_credits_per_day', (select default_credits_per_day from public.ops_settings where id),
    'awaiting_approval', (select count(*) from public.render_stages where stage = 'final_render' and state = 'awaiting_approval'),
    'oldest_wait_h', (select floor(extract(epoch from now() - min(awaiting_since)) / 3600) from public.render_stages
                        where stage = 'final_render' and state = 'awaiting_approval'),
    'running', (select count(*) from public.render_orders where state = 'running'),
    'storage_used_mb', (select round(coalesce(sum(a.bytes), 0) / 1e6) from public.render_deliveries d
                          join public.artifacts a on a.id = d.artifact_id where d.deleted_at is null),
    'storage_budget_mb', (select storage_budget_mb from public.ops_settings where id),
    'worker_floors', 'min_free_gb and min_free_gb_system in each worker''s worker.toml (10 GB each by default)'));
end $$;

-- ---------------------------------------------------------------- scheduled (ops-tick, every minute; service_role)

create function public.render_orders_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  d record;
  expired int := 0;
  paths jsonb := '[]'::jsonb;
  n_days int;
begin
  select approval_days into n_days from public.ops_settings where id;
  for s in select id from public.render_stages
           where stage = 'final_render' and state = 'awaiting_approval' and awaiting_since < now() - make_interval(days => n_days)
           for update skip locked loop
    perform ryagram_private.final_close(s.id, 'expired', 'approval_expired', null, null);
    expired := expired + 1;
  end loop;
  for d in select r.id, r.order_id, r.artifact_id from public.render_deliveries r
           where r.deleted_at is null and r.expires_at < now() for update skip locked loop
    update public.render_deliveries set deleted_at = now() where id = d.id;
    update public.artifacts set deleted_at = now() where id = d.artifact_id
      returning paths || to_jsonb(storage_path) into paths;
    update public.render_orders set state = 'expired', error_code = 'delivery_expired' where id = d.order_id;
  end loop;
  return jsonb_build_object('approvals_expired', expired, 'delete_objects', paths);
end $$;

-- ---------------------------------------------------------------- access

alter table public.render_orders enable row level security;
alter table public.render_stages enable row level security;
alter table public.render_deliveries enable row level security;
alter table public.user_caps enable row level security;
alter table public.story_schemas enable row level security;
revoke all on public.render_orders, public.render_stages, public.render_deliveries, public.user_caps, public.story_schemas
  from anon, authenticated, service_role;
grant select on public.render_orders, public.render_stages, public.render_deliveries to authenticated;
create policy "Owners read their orders" on public.render_orders for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their order stages" on public.render_stages for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their deliveries" on public.render_deliveries for select to authenticated using (owner_id = (select auth.uid()));

-- New private functions: nobody but the definer's own functions (a new function is executable by PUBLIC by default).
revoke execute on function
  ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid),
  ryagram_private.require_app_session(), ryagram_private.credits_last_24h(uuid, uuid), ryagram_private.daily_cap(uuid),
  ryagram_private.stage_for_job(public.job_state),
  ryagram_private.order_stage(public.render_orders, public.render_stage, public.stage_state, uuid),
  ryagram_private.order_end(uuid, public.order_state, text),
  ryagram_private.stage_submit(public.render_orders, public.render_stages, public.job_type, jsonb, uuid, uuid, boolean),
  ryagram_private.story_problem(jsonb), ryagram_private.advance_order(uuid), ryagram_private.jobs_advance_order(),
  ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source),
  ryagram_private.order_request_final(uuid, uuid, text, public.order_source),
  ryagram_private.order_status(uuid, uuid), ryagram_private.order_cancel(uuid, uuid), ryagram_private.delivery_object(uuid, uuid),
  ryagram_private.require_admin(), ryagram_private.final_close(uuid, public.stage_state, text, uuid, text),
  ryagram_private.admin_ops_base()
  from public, anon, authenticated;
revoke execute on function
  public.submit_render_order(jsonb, text, public.order_want, text), public.request_final_render(uuid, text),
  public.render_order_status(uuid), public.cancel_render_order(uuid), public.delivery_object_for(uuid, uuid),
  public.admin_set_auto_render(boolean), public.admin_render_queue(), public.admin_render_decide(uuid, boolean, text),
  public.admin_user_caps(), public.admin_set_user_cap(uuid, int), public.admin_ops(), public.render_orders_tick(),
  public.submit_job(uuid, public.job_type, jsonb, uuid, uuid)
  from public, anon;
revoke execute on function public.delivery_object_for(uuid, uuid), public.render_orders_tick() from authenticated;
grant execute on function
  public.submit_render_order(jsonb, text, public.order_want, text), public.request_final_render(uuid, text),
  public.render_order_status(uuid), public.cancel_render_order(uuid),
  public.admin_set_auto_render(boolean), public.admin_render_queue(), public.admin_render_decide(uuid, boolean, text),
  public.admin_user_caps(), public.admin_set_user_cap(uuid, int), public.admin_ops(),
  public.submit_job(uuid, public.job_type, jsonb, uuid, uuid)
  to authenticated;
grant execute on function public.delivery_object_for(uuid, uuid), public.render_orders_tick() to service_role;

commit;

-- Ryagram Phase 2A core schema: projects, versions, datasets, jobs, artifacts,
-- job_metering, workers, control, and the functions that are the only way to
-- change jobs and artifacts.
--
-- Design: Ryagram-logs\proposals\WEB-2A-SCHEMA.md, approved 2026-09-27 with the
-- WORKER deltas (Ryagram-logs\status\WORKER.md section 3), including retry_job.
-- Worker transitions match WORKER's FakeQueue (Ryagram branch worker, c53c6ab).
--
-- Run after supabase/ryagram-waitlist.sql, in the same project:
-- SQL Editor -> New query -> paste this file -> Run. It is one transaction.
--
-- Who can do what:
--   * A signed-in person sees only rows whose owner_id is theirs.
--   * They change projects/versions directly (limited columns), and jobs only
--     through submit_job / cancel_job.
--   * The render worker is a normal Auth user listed in public.workers. It owns
--     no rows and can only call claim_next_job, heartbeat, report_state,
--     retry_job, register_artifact and write_metering, and upload to the one storage path
--     register_artifact gave it. It never holds the service_role key.
--   * Ryan's kill switch is the single row in public.control (Table Editor).

begin;

-- Helpers live in a schema the Data API does not expose.
create schema if not exists ryagram_private;
revoke all on schema ryagram_private from public;

-- ---------------------------------------------------------------- types

create type public.version_state as enum (
  'draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render',
  'queued', 'rendering', 'validating', 'uploading', 'complete', 'failed',
  'archived', 'non_restorable');
create type public.restorability as enum ('unknown', 'restorable', 'non_restorable');
create type public.dataset_source as enum ('upload', 'catalog');
create type public.dataset_status as enum ('pending_validation', 'approved', 'rejected');
create type public.dataset_retention as enum ('keep', 'dont_keep');
create type public.job_type as enum ('contact_sheet', 'preview', 'final_render');
create type public.job_state as enum (
  'queued', 'claimed', 'running', 'validating', 'uploading',
  'complete', 'failed', 'editorial_action_required', 'cancelled');
create type public.error_class as enum (
  'infrastructure', 'gate', 'invalid_input', 'timeout', 'limit', 'cancelled', 'unknown');
create type public.artifact_kind as enum (
  'contact_sheet', 'preview', 'final_video', 'thumbnail', 'receipt', 'receipt_text', 'metering');

-- ---------------------------------------------------------------- tables

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index projects_owner_idx on public.projects (owner_id, created_at desc);

-- 2A: stories name engine catalog datasets, which the worker allow-lists itself,
-- so jobs.dataset_id is usually null. This table is for uploaded datasets (2B).
create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  source public.dataset_source not null default 'upload',
  storage_path text check (char_length(storage_path) <= 500),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint check (bytes >= 0),
  mime text check (char_length(mime) <= 100),
  row_count bigint check (row_count >= 0),
  status public.dataset_status not null default 'pending_validation',
  retention public.dataset_retention not null default 'keep',
  created_at timestamptz not null default now()
);
create index datasets_owner_idx on public.datasets (owner_id);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  number int not null check (number >= 1),
  parent_version_id uuid references public.versions (id) on delete set null,
  state public.version_state not null default 'draft',
  story_spec jsonb not null default '{}'::jsonb
    check (jsonb_typeof(story_spec) = 'object' and pg_column_size(story_spec) <= 262144),
  story_sha256 text not null default '',          -- set by trigger
  dataset_id uuid references public.datasets (id) on delete restrict,
  restorability public.restorability not null default 'unknown',
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index versions_owner_idx on public.versions (owner_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  job_type public.job_type not null,
  story jsonb not null,                            -- snapshot at submit; never edited
  story_sha256 text not null check (story_sha256 ~ '^[0-9a-f]{64}$'),
  dataset_id uuid references public.datasets (id) on delete restrict,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  -- Final-render ladder evidence (WORKER delta 1). Checked by submit_job and again
  -- by claim_next_job; the worker hands it to the engine.
  sheet_job_id uuid references public.jobs (id) on delete restrict,
  preview_job_id uuid references public.jobs (id) on delete restrict,
  approved_by uuid,
  approved_at timestamptz,
  state public.job_state not null default 'queued',
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  lease_expires_at timestamptz,
  attempt int not null default 1 check (attempt between 1 and 3),
  error_class public.error_class,
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),     -- WORKER delta 3
  error_detail text check (char_length(error_detail) <= 2000),
  worker_id text,                                  -- workers.name, for display
  worker_user_id uuid references auth.users (id) on delete set null,
  heartbeat_at timestamptz,
  engine_commit text check (engine_commit ~ '^[0-9a-f]{7,40}$'),
  engine_dirty boolean,                            -- WORKER delta 4
  progress numeric check (progress between 0 and 1),
  progress_note text check (char_length(progress_note) <= 200),
  check (approved_by is null or approved_by = owner_id),
  check ((job_type = 'final_render') = (sheet_job_id is not null and preview_job_id is not null
                                        and approved_by is not null and approved_at is not null))
);
create index jobs_queue_idx on public.jobs (created_at, id) where state = 'queued';
create index jobs_owner_idx on public.jobs (owner_id, created_at desc);
create index jobs_version_idx on public.jobs (version_id);
create index jobs_active_worker_idx on public.jobs (worker_user_id)
  where state in ('claimed', 'running', 'validating', 'uploading');

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind public.artifact_kind not null,
  bucket text not null default 'ryagram-artifacts' check (bucket = 'ryagram-artifacts'),
  storage_path text not null unique,
  mime text not null,
  bytes bigint not null check (bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_s numeric check (duration_s >= 0),
  width int check (width > 0),
  height int check (height > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,                          -- retention (Phase 3)
  deleted_at timestamptz,
  unique (job_id, kind)
);
create index artifacts_owner_idx on public.artifacts (owner_id);
create index artifacts_version_idx on public.artifacts (version_id);

-- One row per attempt (2A-7 plus WORKER delta 5). NULL means unknown, never 0.
-- claim_next_job creates the row, so the worker that ran an attempt can still
-- write its metering after handing the job back: wasted compute is compute.
create table public.job_metering (
  job_id uuid not null references public.jobs (id) on delete cascade,
  attempt int not null check (attempt between 1 and 3),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  job_type public.job_type not null,
  worker_user_id uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  queue_wait_s numeric check (queue_wait_s >= 0),
  wall_s numeric check (wall_s >= 0),
  session_build_s numeric check (session_build_s >= 0),
  drawing_s numeric check (drawing_s >= 0),
  encode_s numeric check (encode_s >= 0),
  cpu_user_s numeric check (cpu_user_s >= 0),
  cpu_kernel_s numeric check (cpu_kernel_s >= 0),
  peak_job_memory_bytes bigint check (peak_job_memory_bytes >= 0),   -- committed memory of the whole job, not RSS
  frame_cache_peak_bytes bigint check (frame_cache_peak_bytes >= 0),
  bytes_written bigint check (bytes_written >= 0),
  io_write_bytes bigint check (io_write_bytes >= 0),
  processes_total int check (processes_total >= 0),
  work_peak_bytes_sampled bigint check (work_peak_bytes_sampled >= 0),
  media_source_minutes numeric check (media_source_minutes >= 0),
  retry_count int check (retry_count >= 0),
  exit_status int,
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  gate_result text check (gate_result in ('pass', 'fail', 'not_run')),
  engine_commit text check (engine_commit ~ '^[0-9a-f]{7,40}$'),
  engine_dirty boolean,
  receipt_sha256 text check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  notes jsonb check (jsonb_typeof(notes) = 'object' and pg_column_size(notes) <= 16384),
  primary key (job_id, attempt)
);
create index job_metering_owner_idx on public.job_metering (owner_id);

-- Render workers. Add one after creating its Auth user (see supabase/README.md).
-- Set enabled = false to cut a worker off immediately.
create table public.workers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique check (name ~ '^[A-Za-z0-9._-]{1,64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Kill switch: one row. Flip in Table Editor; no website redeploy.
create table public.control (
  id boolean primary key default true check (id),
  claims_enabled boolean not null default true,
  ai_enabled boolean not null default false,
  disabled_job_types public.job_type[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.control default values;

-- ---------------------------------------------------------------- access

alter table public.projects enable row level security;
alter table public.datasets enable row level security;
alter table public.versions enable row level security;
alter table public.jobs enable row level security;
alter table public.artifacts enable row level security;
alter table public.job_metering enable row level security;
alter table public.workers enable row level security;
alter table public.control enable row level security;

-- Nothing here relies on Supabase's default grants. This project has
-- "Automatically expose new tables" OFF (no default grants at all); a project
-- with it ON grants everything. Either way: start from nothing, and grant
-- explicitly everything the app needs -- schema USAGE included, without which
-- every table below is invisible to the Data API.
grant usage on schema public to anon, authenticated;
revoke all on public.projects, public.datasets, public.versions, public.jobs,
  public.artifacts, public.job_metering, public.workers, public.control
  from anon, authenticated;

grant select on public.projects, public.datasets, public.versions, public.jobs,
  public.artifacts, public.job_metering to authenticated;
grant insert (title) on public.projects to authenticated;
grant update (title, archived_at) on public.projects to authenticated;
grant update (story_spec, dataset_id, state, note) on public.versions to authenticated;

create policy "Owners read projects" on public.projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners create projects" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners update projects" on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners read datasets" on public.datasets for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners read versions" on public.versions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners update versions" on public.versions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners read jobs" on public.jobs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners read artifacts" on public.artifacts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners read metering" on public.job_metering for select to authenticated
  using (owner_id = (select auth.uid()));
-- workers and control: no policies, so no access except the dashboard and the
-- security-definer functions below.

-- ---------------------------------------------------------------- private helpers

create function ryagram_private.require_signed_in() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create function ryagram_private.require_worker() returns public.workers
language plpgsql stable security definer set search_path = '' as $$
declare w public.workers;
begin
  select * into w from public.workers where user_id = auth.uid() and enabled;
  if not found then
    raise exception 'Not an enabled worker.' using errcode = '42501';
  end if;
  return w;
end $$;

create function ryagram_private.error_class_for(code text) returns public.error_class
language sql immutable set search_path = '' as $$
  select case
    when code in ('schema_rejected', 'engine_unsupported', 'engine_refused', 'dataset_not_allowed',
                  'ladder_missing') then 'invalid_input'
    when code = 'gate_failed' then 'gate'
    when code in ('crash', 'start_failed', 'worker_lost', 'worker_error', 'upload_failed',
                  'no_receipt', 'no_commit') then 'infrastructure'
    when code = 'timeout' then 'timeout'
    when code = 'limit_exceeded' then 'limit'
    when code = 'cancelled' then 'cancelled'
    else 'unknown'
  end::public.error_class
$$;

-- Transient infrastructure failures may be retried, at most 3 attempts in all
-- (2B-4). Not timeouts: a story that times out once will again. Not no_receipt
-- or no_commit: those are the worker's own setup and won't fix themselves.
create function ryagram_private.is_retryable(code text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(code in ('crash', 'start_failed', 'worker_lost', 'worker_error', 'upload_failed'), false)
$$;

-- A final render may run only if its contact sheet and preview both completed
-- for the same version and the same story, and the owner approved it.
create function ryagram_private.ladder_ok(j public.jobs) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(j.job_type = 'final_render'
     and j.approved_by = j.owner_id and j.approved_at is not null
     and exists (select 1 from public.jobs s
                 where s.id = j.sheet_job_id and s.job_type = 'contact_sheet'
                   and s.state = 'complete' and s.owner_id = j.owner_id
                   and s.version_id = j.version_id and s.story_sha256 = j.story_sha256)
     and exists (select 1 from public.jobs p
                 where p.id = j.preview_job_id and p.job_type = 'preview'
                   and p.state = 'complete' and p.owner_id = j.owner_id
                   and p.version_id = j.version_id and p.story_sha256 = j.story_sha256), false)
$$;

-- Fixed file name and type per artifact kind; the worker never chooses a path.
create function ryagram_private.artifact_file(k public.artifact_kind, out filename text, out mime text, out max_bytes bigint)
language sql immutable set search_path = '' as $$
  select t.filename, t.mime, t.max_bytes from (values
    ('contact_sheet'::public.artifact_kind, 'sheet.png', 'image/png', 20000000::bigint),
    ('preview', 'preview.mp4', 'video/mp4', 60000000),
    ('final_video', 'film.mp4', 'video/mp4', 500000000),
    ('thumbnail', 'thumb.jpg', 'image/jpeg', 5000000),
    ('receipt', 'receipt.sequence.json', 'application/json', 5000000),
    ('receipt_text', 'receipt.txt', 'text/plain', 5000000),
    ('metering', 'metering.json', 'application/json', 5000000)
  ) as t(kind, filename, mime, max_bytes)
  where t.kind = k
$$;

create function ryagram_private.kind_allowed(t public.job_type, k public.artifact_kind) returns boolean
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then k in ('contact_sheet', 'receipt', 'receipt_text', 'metering')
    when 'preview' then k in ('preview', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'final_render' then k in ('final_video', 'thumbnail', 'receipt', 'receipt_text', 'metering')
  end
$$;

create function ryagram_private.required_kinds(t public.job_type) returns public.artifact_kind[]
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then array['contact_sheet']::public.artifact_kind[]
    when 'preview' then array['preview']::public.artifact_kind[]
    when 'final_render' then array['final_video', 'thumbnail', 'receipt']::public.artifact_kind[]
  end
$$;

-- Used by the storage policies: may the calling worker write this object?
create function ryagram_private.worker_may_write(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.artifacts a
    join public.jobs j on j.id = a.job_id
    join public.workers w on w.user_id = j.worker_user_id
    where a.storage_path = object_name
      and w.user_id = auth.uid() and w.enabled
      and j.state in ('running', 'validating', 'uploading'))
$$;

-- ---------------------------------------------------------------- triggers

create function ryagram_private.versions_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Inlined: this runs as the signed-in user, who cannot execute private helpers.
  new.story_sha256 := encode(sha256(convert_to(new.story_spec::text, 'UTF8')), 'hex');
  new.updated_at := now();
  -- Rules for people editing directly. System functions run as the table owner.
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if (new.story_spec is distinct from old.story_spec or new.dataset_id is distinct from old.dataset_id)
       and old.state not in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
      raise exception 'This version is locked (%). Make a new version to change it.', old.state
        using errcode = '42501';
    end if;
    -- A finished version never becomes editable again; change it by making
    -- r(n+1) with create_version. The one move allowed by hand is complete -> archived.
    if new.state is distinct from old.state and not (
         (old.state = 'complete' and new.state = 'archived')
         or (old.state in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render')
             and new.state in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render', 'archived'))) then
      raise exception 'Cannot move a version from % to % by hand. Make a new version instead.', old.state, new.state
        using errcode = '42501';
    end if;
    if new.dataset_id is not null and new.dataset_id is distinct from old.dataset_id
       and not exists (select 1 from public.datasets d where d.id = new.dataset_id and d.owner_id = old.owner_id) then
      raise exception 'Dataset not found.' using errcode = 'P0002';
    end if;
  end if;
  return new;
end $$;
create trigger versions_before_write before insert or update on public.versions
  for each row execute function ryagram_private.versions_before_write();

create function ryagram_private.projects_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger projects_touch before update on public.projects
  for each row execute function ryagram_private.projects_touch();

-- The library shows a version's render state from its final-render job, so the
-- two can never disagree.
create function ryagram_private.sync_version_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.job_type = 'final_render' and (tg_op = 'INSERT' or new.state is distinct from old.state) then
    update public.versions set state = case new.state
        when 'queued' then 'queued'
        when 'claimed' then 'rendering'
        when 'running' then 'rendering'
        when 'validating' then 'validating'
        when 'uploading' then 'uploading'
        when 'complete' then 'complete'
        when 'failed' then 'failed'
        when 'editorial_action_required' then 'editorial_action_required'
        when 'cancelled' then 'ready_to_render'
      end::public.version_state
    where id = new.version_id;
  end if;
  return new;
end $$;
create trigger jobs_sync_version_state after insert or update of state on public.jobs
  for each row execute function ryagram_private.sync_version_state();

-- ---------------------------------------------------------------- browser functions

-- r1 for a new story, or r(n+1) copied from an existing version. The source
-- version is only read, so r1 is never changed by work on r2 (2A-2).
create function public.create_version(p_project_id uuid, p_from_version_id uuid default null)
returns public.versions
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  src public.versions;
  next_number int;
  result public.versions;
begin
  perform 1 from public.projects
    where id = p_project_id and owner_id = me and archived_at is null
    for update;                                    -- serialises numbering
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_from_version_id is not null then
    select * into src from public.versions
      where id = p_from_version_id and project_id = p_project_id and owner_id = me;
    if not found then
      raise exception 'Version not found.' using errcode = 'P0002';
    end if;
  end if;
  select coalesce(max(number), 0) + 1 into next_number from public.versions where project_id = p_project_id;
  insert into public.versions (owner_id, project_id, number, parent_version_id, story_spec, dataset_id)
    values (me, p_project_id, next_number, src.id, coalesce(src.story_spec, '{}'::jsonb), src.dataset_id)
    returning * into result;
  update public.projects set updated_at = now() where id = p_project_id;
  return result;
end $$;

create function public.submit_job(
  p_version_id uuid,
  p_job_type public.job_type,
  p_params jsonb default '{}'::jsonb,
  p_sheet_job_id uuid default null,
  p_preview_job_id uuid default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  ctl public.control;
  bad_key text;
  result public.jobs;
begin
  select * into v from public.versions where id = p_version_id and owner_id = me for update;
  if not found then
    raise exception 'Version not found.' using errcode = 'P0002';
  end if;
  if v.state in ('queued', 'rendering', 'validating', 'uploading', 'archived', 'non_restorable') then
    raise exception 'This version is % and cannot take new jobs.', v.state using errcode = '42501';
  end if;

  select * into ctl from public.control where id;
  if p_job_type = any (ctl.disabled_job_types) then
    raise exception '% jobs are paused.', p_job_type using errcode = '42501';
  end if;

  -- Light shape check. The worker validates the full story schema and is the
  -- check that counts; a submit-time Edge Function will add the same schema.
  if (v.story_spec->>'schema' = '1' and v.story_spec->>'engine' = 'sequence') is not true then
    raise exception 'The story is not a schema-1 sequence yet.' using errcode = '22023';
  end if;

  -- Parameters: allow-listed keys only, bounded values (WORKER section 3).
  p_params := coalesce(p_params, '{}'::jsonb);
  if jsonb_typeof(p_params) <> 'object' then
    raise exception 'Parameters must be an object.' using errcode = '22023';
  end if;
  select k into bad_key from jsonb_object_keys(p_params) k
    where k <> all (case p_job_type
                      when 'contact_sheet' then array['periods']
                      when 'preview' then array['window_s']
                      else array[]::text[] end)
    limit 1;
  if bad_key is not null then
    raise exception 'Unknown parameter "%" for %.', bad_key, p_job_type using errcode = '22023';
  end if;
  -- Nested IFs, not AND chains: SQL does not promise to stop at the first false.
  if p_params ? 'window_s' then          -- preview seconds [a, b], at most 10 s long
    if jsonb_typeof(p_params->'window_s') <> 'array' then
      raise exception 'window_s must be [start, end] in seconds.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_params->'window_s') <> 2
       or jsonb_typeof(p_params->'window_s'->0) <> 'number'
       or jsonb_typeof(p_params->'window_s'->1) <> 'number' then
      raise exception 'window_s must be [start, end] in seconds.' using errcode = '22023';
    end if;
    if not ((p_params->'window_s'->>0)::numeric >= 0
            and (p_params->'window_s'->>1)::numeric > (p_params->'window_s'->>0)::numeric
            and (p_params->'window_s'->>1)::numeric - (p_params->'window_s'->>0)::numeric <= 10) then
      raise exception 'window_s must start at 0 or later and span at most 10 seconds.' using errcode = '22023';
    end if;
  end if;
  if p_params ? 'periods' then           -- contact sheet: 3 to 5 years
    if jsonb_typeof(p_params->'periods') <> 'array' then
      raise exception 'periods must be 3 to 5 years like "2016".' using errcode = '22023';
    end if;
    if jsonb_array_length(p_params->'periods') not between 3 and 5
       or exists (select 1 from jsonb_array_elements(p_params->'periods') e
                  where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^\d{4}$') then
      raise exception 'periods must be 3 to 5 years like "2016".' using errcode = '22023';
    end if;
  end if;

  if v.dataset_id is not null and not exists (
       select 1 from public.datasets d where d.id = v.dataset_id and d.owner_id = me and d.status = 'approved') then
    raise exception 'The dataset has not been approved.' using errcode = '42501';
  end if;

  if exists (select 1 from public.jobs j where j.version_id = v.id and j.job_type = p_job_type
               and j.state in ('queued', 'claimed', 'running', 'validating', 'uploading')) then
    raise exception 'A % job for this version is already in progress.', p_job_type using errcode = '42501';
  end if;

  if p_job_type = 'final_render' then
    if p_sheet_job_id is null or p_preview_job_id is null then
      raise exception 'A final render needs its contact sheet and preview.' using errcode = '22023';
    end if;
  elsif p_sheet_job_id is not null or p_preview_job_id is not null then
    raise exception 'Only a final render takes a contact sheet and preview.' using errcode = '22023';
  end if;

  insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256,
                           dataset_id, params, sheet_job_id, preview_job_id, approved_by, approved_at)
    values (me, v.project_id, v.id, p_job_type, v.story_spec, v.story_sha256,
            v.dataset_id, p_params, p_sheet_job_id, p_preview_job_id,
            case when p_job_type = 'final_render' then me end,
            case when p_job_type = 'final_render' then now() end)
    returning * into result;

  if p_job_type = 'final_render' and not ryagram_private.ladder_ok(result) then
    raise exception 'The contact sheet and preview must both be complete for this exact story.'
      using errcode = '42501';                      -- rolls back the insert
  end if;
  return result;
end $$;

create function public.cancel_job(p_job_id uuid)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id and owner_id = me for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if j.state = 'queued' then
    update public.jobs set state = 'cancelled', ended_at = now(),
        error_class = 'cancelled', error_code = 'cancelled'
      where id = j.id returning * into j;
  elsif j.state in ('claimed', 'running', 'validating', 'uploading') then
    -- The worker sees this on its next heartbeat, stops, and reports cancelled.
    update public.jobs set cancel_requested = true where id = j.id returning * into j;
  else
    raise exception 'This job has already finished (%).', j.state using errcode = '42501';
  end if;
  return j;
end $$;

-- 1 = next to run. Null when the job is not waiting. Never reveals other jobs.
create function public.queue_position(p_job_id uuid)
returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id and owner_id = me;
  if not found or j.state <> 'queued' then
    return null;
  end if;
  return (select count(*) + 1 from public.jobs q
          where q.state = 'queued' and (q.created_at, q.id) < (j.created_at, j.id))::int;
end $$;

-- ---------------------------------------------------------------- worker functions

-- Returns zero or one job. Also puts back jobs whose worker stopped heartbeating.
-- The worker's identity is its login; there is no worker_id argument to trust.
create function public.claim_next_job()
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
        worker_id = null, worker_user_id = null, progress = null, progress_note = null
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

-- Every ~15 s while working. Returns true when the owner asked to cancel.
create function public.heartbeat(p_job_id uuid, p_progress numeric default null, p_note text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  wants_cancel boolean;
begin
  update public.jobs set heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes',
      progress = coalesce(p_progress, progress), progress_note = coalesce(left(p_note, 200), progress_note)
    where id = p_job_id and worker_user_id = w.user_id
      and state in ('claimed', 'running', 'validating', 'uploading')
    returning cancel_requested into wants_cancel;
  if not found then
    raise exception 'This worker does not hold job %.', p_job_id using errcode = '42501';
  end if;
  return wants_cancel;
end $$;

-- Moves a held job forward, or ends it. Only these moves are legal (the same
-- table as WORKER's FakeQueue):
--   claimed    -> running | failed | cancelled
--   running    -> validating | failed | editorial_action_required | cancelled
--   validating -> uploading | failed | editorial_action_required
--   uploading  -> complete | failed
-- failed is final. To retry a transient failure, call retry_job instead.
create function public.report_state(
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
       ('validating', 'uploading'), ('validating', 'failed'), ('validating', 'editorial_action_required'),
       ('uploading', 'complete'), ('uploading', 'failed')) then
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
create function public.retry_job(p_job_id uuid, p_error_code text, p_error_detail text default null)
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
      worker_id = null, worker_user_id = null, progress = null, progress_note = null
    where id = j.id returning * into j;
  return j.state::text;
end $$;

-- Reserves the one storage path the worker may upload this artifact to.
-- Upload it with the Content-Type for its kind (see artifact_file).
create function public.register_artifact(
  p_job_id uuid,
  p_kind public.artifact_kind,
  p_bytes bigint,
  p_sha256 text,
  p_duration_s numeric default null,
  p_width int default null,
  p_height int default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  j public.jobs;
  f record;
  object_path text;
begin
  select * into j from public.jobs
    where id = p_job_id and worker_user_id = w.user_id and state = 'uploading';
  if not found then
    raise exception 'This worker does not hold job % in the uploading state.', p_job_id using errcode = '42501';
  end if;
  if not ryagram_private.kind_allowed(j.job_type, p_kind) then
    raise exception 'A % job does not produce %.', j.job_type, p_kind using errcode = '22023';
  end if;
  select * into f from ryagram_private.artifact_file(p_kind);
  if p_bytes is null or p_bytes < 0 or p_bytes > f.max_bytes then
    raise exception '% must be at most % bytes.', p_kind, f.max_bytes using errcode = '22023';
  end if;
  object_path := j.owner_id || '/' || j.project_id || '/' || j.version_id || '/' || j.id || '/' || f.filename;
  insert into public.artifacts (owner_id, project_id, version_id, job_id, kind, storage_path,
                                mime, bytes, sha256, duration_s, width, height)
    values (j.owner_id, j.project_id, j.version_id, j.id, p_kind, object_path,
            f.mime, p_bytes, p_sha256, p_duration_s, p_width, p_height)
    on conflict (job_id, kind) do update set
      bytes = excluded.bytes, sha256 = excluded.sha256, duration_s = excluded.duration_s,
      width = excluded.width, height = excluded.height, created_at = now();
  return object_path;
end $$;

-- Fills in the metering row for one attempt this worker ran, including an
-- attempt it already handed back or ended. Keys must be metering columns;
-- keys left out keep their value. Unknown values: leave them out.
create function public.write_metering(p_job_id uuid, p_attempt int, p_metrics jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  m public.job_metering;
  bad_key text;
begin
  select * into m from public.job_metering
    where job_id = p_job_id and attempt = p_attempt and worker_user_id = w.user_id
    for update;
  if not found then
    raise exception 'This worker did not run attempt % of job %.', p_attempt, p_job_id using errcode = '42501';
  end if;
  if jsonb_typeof(p_metrics) is distinct from 'object' then
    raise exception 'Metrics must be an object.' using errcode = '22023';
  end if;
  select k into bad_key from jsonb_object_keys(p_metrics) k
    where k <> all (array['queue_wait_s', 'wall_s', 'session_build_s', 'drawing_s', 'encode_s',
                          'cpu_user_s', 'cpu_kernel_s', 'peak_job_memory_bytes', 'frame_cache_peak_bytes',
                          'bytes_written', 'io_write_bytes', 'processes_total', 'work_peak_bytes_sampled',
                          'media_source_minutes', 'retry_count', 'exit_status', 'error_code', 'gate_result',
                          'engine_commit', 'engine_dirty', 'receipt_sha256', 'notes'])
    limit 1;
  if bad_key is not null then
    raise exception 'Unknown metering field "%".', bad_key using errcode = '22023';
  end if;
  m := jsonb_populate_record(m, p_metrics);
  update public.job_metering set
      recorded_at = now(),
      queue_wait_s = m.queue_wait_s, wall_s = m.wall_s, session_build_s = m.session_build_s,
      drawing_s = m.drawing_s, encode_s = m.encode_s, cpu_user_s = m.cpu_user_s, cpu_kernel_s = m.cpu_kernel_s,
      peak_job_memory_bytes = m.peak_job_memory_bytes, frame_cache_peak_bytes = m.frame_cache_peak_bytes,
      bytes_written = m.bytes_written, io_write_bytes = m.io_write_bytes, processes_total = m.processes_total,
      work_peak_bytes_sampled = m.work_peak_bytes_sampled, media_source_minutes = m.media_source_minutes,
      retry_count = m.retry_count, exit_status = m.exit_status, error_code = m.error_code,
      gate_result = m.gate_result, engine_commit = m.engine_commit, engine_dirty = m.engine_dirty,
      receipt_sha256 = m.receipt_sha256, notes = m.notes
    where job_id = p_job_id and attempt = p_attempt;
end $$;

-- Function access. Postgres lets PUBLIC execute new functions and Supabase adds
-- anon/authenticated, so revoke everything, then grant each function to the
-- signed-in role only. Worker functions check public.workers themselves.
revoke execute on all functions in schema ryagram_private from public, anon, authenticated;
revoke execute on function
  public.create_version(uuid, uuid),
  public.submit_job(uuid, public.job_type, jsonb, uuid, uuid),
  public.cancel_job(uuid),
  public.queue_position(uuid),
  public.claim_next_job(),
  public.heartbeat(uuid, numeric, text),
  public.report_state(uuid, public.job_state, text, text, text, boolean),
  public.retry_job(uuid, text, text),
  public.register_artifact(uuid, public.artifact_kind, bigint, text, numeric, int, int),
  public.write_metering(uuid, int, jsonb)
  from public, anon;
grant execute on function
  public.create_version(uuid, uuid),
  public.submit_job(uuid, public.job_type, jsonb, uuid, uuid),
  public.cancel_job(uuid),
  public.queue_position(uuid),
  public.claim_next_job(),
  public.heartbeat(uuid, numeric, text),
  public.report_state(uuid, public.job_state, text, text, text, boolean),
  public.retry_job(uuid, text, text),
  public.register_artifact(uuid, public.artifact_kind, bigint, text, numeric, int, int),
  public.write_metering(uuid, int, jsonb)
  to authenticated;
-- Storage policies call this one as the uploading user.
grant usage on schema ryagram_private to authenticated;
grant execute on function ryagram_private.worker_may_write(text) to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ryagram-artifacts', 'ryagram-artifacts', false, 500000000,
          array['video/mp4', 'image/png', 'image/jpeg', 'application/json', 'text/plain'])
  on conflict (id) do nothing;

create policy "Owners read their artifacts" on storage.objects for select to authenticated
  using (bucket_id = 'ryagram-artifacts'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Worker reads what it is uploading" on storage.objects for select to authenticated
  using (bucket_id = 'ryagram-artifacts' and ryagram_private.worker_may_write(name));
create policy "Worker uploads registered artifacts" on storage.objects for insert to authenticated
  with check (bucket_id = 'ryagram-artifacts' and ryagram_private.worker_may_write(name));
create policy "Worker replaces registered artifacts" on storage.objects for update to authenticated
  using (bucket_id = 'ryagram-artifacts' and ryagram_private.worker_may_write(name))
  with check (bucket_id = 'ryagram-artifacts' and ryagram_private.worker_may_write(name));

-- ---------------------------------------------------------------- realtime

-- Job status UI listens for changes; RLS still decides who receives what.
alter publication supabase_realtime add table public.jobs, public.versions;

commit;

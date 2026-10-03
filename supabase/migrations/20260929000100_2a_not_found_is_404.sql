-- Ryagram 2A follow-up: "not found" answers come back as HTTP 404, not 500.
--
-- Run after the five 2A files (SQL Editor -> New query -> paste -> Run). One transaction.
-- Found by the 2A-1 acceptance test on the live project: when someone asks for a project,
-- version, job or dataset that isn't theirs, the functions refuse with errcode P0002, which
-- PostgREST reports as HTTP 500. They were refused correctly; only the status was wrong.
-- PostgREST turns an errcode of the form PTxxx into HTTP status xxx, so these now use PT404.
-- Each function below is the latest version (submit_job from 20260928000200) with only
-- that code changed. create or replace keeps owners, grants and the trigger binding.

begin;

create or replace function ryagram_private.versions_before_write() returns trigger
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
      raise exception 'Dataset not found.' using errcode = 'PT404';
    end if;
  end if;
  return new;
end $$;

create or replace function public.create_version(p_project_id uuid, p_from_version_id uuid default null)
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
    raise exception 'Project not found.' using errcode = 'PT404';
  end if;
  if p_from_version_id is not null then
    select * into src from public.versions
      where id = p_from_version_id and project_id = p_project_id and owner_id = me;
    if not found then
      raise exception 'Version not found.' using errcode = 'PT404';
    end if;
  end if;
  select coalesce(max(number), 0) + 1 into next_number from public.versions where project_id = p_project_id;
  insert into public.versions (owner_id, project_id, number, parent_version_id, story_spec, dataset_id)
    values (me, p_project_id, next_number, src.id, coalesce(src.story_spec, '{}'::jsonb), src.dataset_id)
    returning * into result;
  update public.projects set updated_at = now() where id = p_project_id;
  return result;
end $$;

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
  v public.versions;
  ctl public.control;
  bad_key text;
  result public.jobs;
begin
  select * into v from public.versions where id = p_version_id and owner_id = me for update;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;
  -- A complete version is finished (rebuilds are a later, separate action). A
  -- failed one may retry its final render, so an infrastructure failure is not a dead end.
  if v.state in ('queued', 'rendering', 'validating', 'uploading', 'complete', 'archived', 'non_restorable') then
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

create or replace function public.cancel_job(p_job_id uuid)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id and owner_id = me for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'PT404';
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

commit;

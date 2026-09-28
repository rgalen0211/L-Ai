-- Ryagram 2A follow-up: a complete version takes no new jobs.
--
-- Run after 20260928000100_2a_core.sql (SQL Editor -> New query -> paste -> Run).
-- Found while building the job screen: submit_job accepted a new final render
-- on a complete version, and the jobs trigger would then move that finished
-- version back to "queued". Claude's rule is that finished versions stay
-- finished; rebuilding one is a separate Phase 3 action. A failed version may
-- still retry its final render, so an infrastructure failure is not a dead end.
--
-- The only change from the core file is 'complete' in the first state check.
-- create or replace keeps the function's owner and grants.

begin;

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
    raise exception 'Version not found.' using errcode = 'P0002';
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

commit;

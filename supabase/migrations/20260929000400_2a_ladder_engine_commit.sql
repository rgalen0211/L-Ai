-- Ryagram 2A follow-up: a final render carries the engine commit its preview was drawn with.
--
-- Run after 20260929000100_2a_not_found_is_404.sql (SQL Editor -> New query -> paste -> Run).
-- Requested by WORKER (2026-09-29) for the engine's ladder evidence: an approval is of a
-- picture, and the picture changes when the engine does. If Ryan updates the worker between
-- preview and final, the engine must refuse the final and the ladder must be climbed again.
-- The worker can't supply the commit itself (it can't read other jobs, and using the commit it
-- is running would make the check certify itself), so the database records it:
--   * jobs.ladder_engine_commit: set by submit_job for a final_render from its preview's
--     engine_commit, and returned to the worker by claim_next_job with the rest of the row.
--   * ladder_ok also requires the sheet and preview to come from the same engine commit, and
--     the final's ladder_engine_commit to equal the preview's (checked again at claim time).
--   * submit_job refuses a final whose preview has no engine commit, with a clear message.
-- submit_job below is the 20260929000100 version with only these changes.

begin;

alter table public.jobs add column ladder_engine_commit text
  check (ladder_engine_commit ~ '^[0-9a-f]{7,40}$');

create or replace function ryagram_private.ladder_ok(j public.jobs) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(j.job_type = 'final_render'
     and j.approved_by = j.owner_id and j.approved_at is not null
     and exists (select 1
                 from public.jobs s, public.jobs p
                 where s.id = j.sheet_job_id and s.job_type = 'contact_sheet'
                   and s.state = 'complete' and s.owner_id = j.owner_id
                   and s.version_id = j.version_id and s.story_sha256 = j.story_sha256
                   and p.id = j.preview_job_id and p.job_type = 'preview'
                   and p.state = 'complete' and p.owner_id = j.owner_id
                   and p.version_id = j.version_id and p.story_sha256 = j.story_sha256
                   -- one ladder = one engine: sheet, preview and the final's evidence agree
                   and s.engine_commit is not null and s.engine_commit = p.engine_commit
                   and j.ladder_engine_commit = p.engine_commit), false)
$$;

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
  ladder_commit text;
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

  -- The approval is of the preview as that engine drew it. Carry the preview's engine commit
  -- onto the final so the engine can refuse if it has changed since (WORKER, 2026-09-29).
  if p_job_type = 'final_render' then
    select engine_commit into ladder_commit from public.jobs
      where id = p_preview_job_id and owner_id = me and job_type = 'preview';
    if ladder_commit is null then
      raise exception 'The preview has no engine version recorded. Make a new preview first.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256,
                           dataset_id, params, sheet_job_id, preview_job_id, approved_by, approved_at,
                           ladder_engine_commit)
    values (me, v.project_id, v.id, p_job_type, v.story_spec, v.story_sha256,
            v.dataset_id, p_params, p_sheet_job_id, p_preview_job_id,
            case when p_job_type = 'final_render' then me end,
            case when p_job_type = 'final_render' then now() end,
            ladder_commit)
    returning * into result;

  if p_job_type = 'final_render' and not ryagram_private.ladder_ok(result) then
    raise exception 'The contact sheet and preview must both be complete, for this exact story, from the same engine version.'
      using errcode = '42501';                      -- rolls back the insert
  end if;
  return result;
end $$;

commit;

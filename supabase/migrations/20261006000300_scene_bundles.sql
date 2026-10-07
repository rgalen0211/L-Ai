-- Ryagram: scene bundles, part 2 of 2. The web app's interactive preview.
--
-- Run after 20261006000200_scene_bundle_types.sql. Spec: Ryagram SCENE-BUNDLE.md (BUILDER).
--
-- A scene bundle is what the browser draws a film from (scene.json.gz + fonts), so a
-- person can scrub their film without a render. The worker builds it with the engine
-- (a session only: no frames, no video) and uploads it as ONE file, scene.bundle.zip.
--
--   * Asked for through request_scene_bundle(version) only. submit_job refuses it, so
--     the cache below cannot be bypassed.
--   * Cached per film version: a finished bundle is reused while the version's story
--     (story_sha256) and the worker's engine (current_engine_commit()) are unchanged.
--     Change either and the next request builds a new one.
--   * Only the version's owner can ask for it or read it (the existing artifact rules:
--     owner_may_read needs the artifact's owner to be the reader, and the job complete).
--   * Free: never charged. (phase-2b/credits_ledger.sql prices it at 0 credits.) Capped
--     instead: 3 building at once and 20 new builds an hour per person.
--   * v1: catalog films only (no uploaded datasets), per WEB-LIVE-PREVIEW.md.
--   * Off until the worker can build bundles: 'scene_bundle' starts in
--     control.disabled_job_types. Ryan removes it from there to turn bundles on.

begin;

-- ---------------------------------------------------------------- the artifact

create or replace function ryagram_private.artifact_file(k public.artifact_kind, out filename text, out mime text, out max_bytes bigint)
language sql immutable set search_path = '' as $$
  select t.filename, t.mime, t.max_bytes from (values
    ('contact_sheet'::public.artifact_kind, 'sheet.png', 'image/png', 20000000::bigint),
    ('preview', 'preview.mp4', 'video/mp4', 60000000),
    ('final_video', 'film.mp4', 'video/mp4', 500000000),
    ('thumbnail', 'thumb.jpg', 'image/jpeg', 5000000),
    ('receipt', 'receipt.sequence.json', 'application/json', 5000000),
    ('receipt_text', 'receipt.txt', 'text/plain', 5000000),
    ('metering', 'metering.json', 'application/json', 5000000),
    ('scene_bundle', 'scene.bundle.zip', 'application/zip', 50000000)
  ) as t(kind, filename, mime, max_bytes)
  where t.kind = k
$$;

-- An unknown job type now answers false / is refused, instead of NULL (which let it through).
create or replace function ryagram_private.kind_allowed(t public.job_type, k public.artifact_kind) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(case t
    when 'contact_sheet' then k in ('contact_sheet', 'receipt', 'receipt_text', 'metering')
    when 'preview' then k in ('preview', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'final_render' then k in ('final_video', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'scene_bundle' then k in ('scene_bundle', 'metering')
  end, false)
$$;

create or replace function ryagram_private.required_kinds(t public.job_type) returns public.artifact_kind[]
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then array['contact_sheet']::public.artifact_kind[]
    when 'preview' then array['preview']::public.artifact_kind[]
    when 'final_render' then array['final_video', 'thumbnail', 'receipt']::public.artifact_kind[]
    when 'scene_bundle' then array['scene_bundle']::public.artifact_kind[]
  end
$$;

update storage.buckets
  set allowed_mime_types = array(select distinct m from unnest(allowed_mime_types || array['application/zip']) m order by 1)
  where id = 'ryagram-artifacts';

-- Off until the worker builds bundles.
update public.control set disabled_job_types = array(
    select distinct t from unnest(disabled_job_types || array['scene_bundle']::public.job_type[]) t)
  where id;

-- ---------------------------------------------------------------- only through the request

-- request_scene_bundle sets this for its own insert; everything else (submit_job, a
-- direct insert) is refused. Transaction-local, and PostgREST runs each call in its own
-- transaction, so a caller cannot carry it over.
create function ryagram_private.scene_bundle_by_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.job_type = 'scene_bundle'
     and coalesce(current_setting('ryagram.scene_bundle_request', true), '') <> 'on' then
    raise exception 'Scene bundles are made through request_scene_bundle.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function ryagram_private.scene_bundle_by_request() from public, anon, authenticated;
create trigger jobs_scene_bundle_by_request before insert on public.jobs
  for each row execute function ryagram_private.scene_bundle_by_request();

-- ---------------------------------------------------------------- the request

-- status:
--   ready     the bundle is built for this story and the current engine; storage_path is
--             the file (sign it with createSignedUrl, as for any artifact).
--   building  a bundle for this story is queued or being built; poll again, or watch job_id.
--   failed    the last bundle for this story and engine failed for a reason a retry will
--             not fix (error_detail says why). Edit the story, or wait for a new engine.
-- A new request after the story or the engine changes builds a new bundle.
create function public.request_scene_bundle(p_version_id uuid)
returns table (status text, job_id uuid, storage_path text, engine_commit text, error_detail text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
-- (the output columns share names with table columns; in queries, names mean the columns)
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  ctl public.control;
  engine text := public.current_engine_commit();
  j public.jobs;
  hit uuid;
  path text;
begin
  select * into v from public.versions where id = p_version_id and owner_id = me for update;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;
  if v.state in ('archived', 'non_restorable') then
    raise exception 'This version is % and has no preview.', v.state using errcode = '42501';
  end if;
  if (v.story_spec->>'schema' = '1' and v.story_spec->>'engine' = 'sequence') is not true then
    raise exception 'The story is not a schema-1 sequence yet.' using errcode = '22023';
  end if;

  -- 1. The cache: a finished bundle of this exact story, from the engine running now.
  if engine is not null then
    select j2.id, a.storage_path into hit, path
      from public.jobs j2 join public.artifacts a on a.job_id = j2.id and a.kind = 'scene_bundle'
      where j2.version_id = v.id and j2.job_type = 'scene_bundle' and j2.state = 'complete'
        and j2.story_sha256 = v.story_sha256 and j2.engine_commit = engine
        and a.owner_id = me and a.deleted_at is null
        and exists (select 1 from storage.objects o where o.bucket_id = a.bucket and o.name = a.storage_path)
      order by j2.ended_at desc limit 1;
    if found then
      return query select 'ready'::text, hit, path, engine, null::text;
      return;
    end if;
  end if;

  -- 2. Already building this story: the same job. A bundle of an older story is no use;
  --    stop it (queued: cancelled now; running: the worker stops at its next heartbeat).
  select * into j from public.jobs
    where version_id = v.id and job_type = 'scene_bundle'
      and state in ('queued', 'claimed', 'running', 'validating', 'uploading')
      and story_sha256 = v.story_sha256
    order by created_at desc limit 1;
  if found then
    return query select 'building'::text, j.id, null::text, null::text, null::text;
    return;
  end if;
  update public.jobs set state = 'cancelled', ended_at = now(), error_class = 'cancelled', error_code = 'cancelled'
    where version_id = v.id and job_type = 'scene_bundle' and state = 'queued';
  update public.jobs set cancel_requested = true
    where version_id = v.id and job_type = 'scene_bundle' and state in ('claimed', 'running', 'validating', 'uploading');

  -- 3. Don't rebuild what will fail again: the last bundle of this story, from this
  --    engine, failed on its input (not the machine's fault).
  select * into j from public.jobs
    where version_id = v.id and job_type = 'scene_bundle' and story_sha256 = v.story_sha256
      and state in ('failed', 'editorial_action_required') and error_class <> 'infrastructure'
      and engine is not null and engine_commit = engine
    order by ended_at desc limit 1;
  if found then
    return query select 'failed'::text, j.id, null::text, j.engine_commit,
      coalesce(j.error_detail, 'The engine could not build a preview of this story.');
    return;
  end if;

  -- 4. Build one.
  select * into ctl from public.control where id;
  if 'scene_bundle' = any (ctl.disabled_job_types) then
    raise exception 'Interactive previews are paused.' using errcode = '42501';
  end if;
  -- v1: catalog films only. A bundle carries the values the film draws, and for an
  -- upload those are the person's own; not stored as a bundle until CC1 has reviewed
  -- that (WEB-LIVE-PREVIEW.md, decision 2). Lifting this is one line.
  if v.dataset_id is not null then
    raise exception 'Interactive previews are for catalog films only for now.' using errcode = '42501';
  end if;
  if (select count(*) from public.jobs where owner_id = me and job_type = 'scene_bundle'
        and state in ('queued', 'claimed', 'running', 'validating', 'uploading')) >= 3 then
    raise exception 'Three previews are already being built. Try again when one is ready.' using errcode = '42501';
  end if;
  -- A free job must not be a way to load the render machine (WEB: 20 new builds an hour).
  if (select count(*) from public.jobs where owner_id = me and job_type = 'scene_bundle'
        and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'That is 20 previews built in the last hour. Try again later.' using errcode = '42501';
  end if;

  perform set_config('ryagram.scene_bundle_request', 'on', true);
  insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, dataset_id, params)
    values (me, v.project_id, v.id, 'scene_bundle', v.story_spec, v.story_sha256, v.dataset_id, '{}'::jsonb)
    returning * into j;
  perform set_config('ryagram.scene_bundle_request', '', true);
  return query select 'building'::text, j.id, null::text, null::text, null::text;
end $$;

revoke execute on function public.request_scene_bundle(uuid) from public, anon;
grant execute on function public.request_scene_bundle(uuid) to authenticated;

commit;

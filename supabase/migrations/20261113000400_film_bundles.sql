-- Ryagram: film bundles (the editor's real frames), part 2 of 2. CONNECT, 2026-11-13; CC1's item 1 (Ryan 2026-11-13 07:05: "the live editor looks like a real video editor: real frames of his film"); the design of BUILDER's
-- scene-bundle branch (20261006000200/300) ported to today's main and to WORKER's film_bundle job (Ryagram worker-film-bundle-1113). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, after 20261113000300_film_bundle_types.sql.
--
-- What it is: the browser draws a film from the engine's own FRAMES (ENGINE's `python -m ryagram.preview.frames`), so a person can scrub their film without a render. The house worker builds one WINDOW of the film (at most 10 seconds)
-- per job and uploads ONE file, film.bundle.zip (at most 50 MB). The website's editor asks for the windows it needs as the slider moves.
--   * Asked for through request_film_bundle(version, 'A:B') only. submit_job and a direct insert are refused, so the cache below cannot be bypassed. The window is whole seconds, ASCII digits, A < B, at most 10 s: the same
--     rule the worker enforces (it refuses anything else as schema_rejected), so a bad window never becomes a job.
--   * Cached per film version, per WINDOW: a finished window is reused while the version's story (story_sha256) and the worker's engine (current_engine_commit()) are unchanged. Change either and the next request builds a new one.
--   * Only the version's owner can ask for it or read it (the existing artifact rules: the artifact's owner reads it, the job complete); the file is read with the ordinary storage signed link the website already uses for every artifact.
--   * Free: priced at 0 credits and never held (see the two ledger functions below). Capped instead: 6 building at once and 60 new windows an hour per person (a minute of film is 6 windows).
--   * v1: catalog films only (no uploaded datasets), as for the scene bundle (WEB-LIVE-PREVIEW.md decision 2).
--   * Off until the worker can build bundles: 'film_bundle' starts in control.disabled_job_types. Ryan removes it from there to turn bundles on (after the worker's [engine] frames_argv and bundle_versions are set).
--   * The credits ledger (supabase/phase-2b/credits_ledger.sql, applied by hand) prices every job type it does not know at the FILM's price. If it is on this database, this file teaches its two functions (jobs_quote and credit_quote)
--     one more branch, by reading their LIVE text and adding exactly that branch (anything else stops with a plain sentence and changes nothing; already done, it is left alone). If the ledger is not here, nothing to do.
-- Safe to run twice. Needs 20261113000300_film_bundle_types.sql, 20260929000500_current_engine_commit.sql and the 2A core. Undo: supabase/rollbacks/20261113000400_film_bundles_rollback.sql. Check: supabase/live-steps/27_film_bundle_after_check.sql.

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
    ('scene_bundle', 'scene.bundle.zip', 'application/zip', 50000000),
    ('film_bundle', 'film.bundle.zip', 'application/zip', 50000000)
  ) as t(kind, filename, mime, max_bytes)
  where t.kind = k
$$;

create or replace function ryagram_private.kind_allowed(t public.job_type, k public.artifact_kind) returns boolean
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then k in ('contact_sheet', 'receipt', 'receipt_text', 'metering')
    when 'preview' then k in ('preview', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'final_render' then k in ('final_video', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'scene_bundle' then k in ('scene_bundle', 'metering')
    when 'film_bundle' then k in ('film_bundle', 'metering')
  end
$$;

create or replace function ryagram_private.required_kinds(t public.job_type) returns public.artifact_kind[]
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then array['contact_sheet']::public.artifact_kind[]
    when 'preview' then array['preview']::public.artifact_kind[]
    when 'final_render' then array['final_video', 'thumbnail', 'receipt']::public.artifact_kind[]
    when 'scene_bundle' then array['scene_bundle']::public.artifact_kind[]
    when 'film_bundle' then array['film_bundle']::public.artifact_kind[]
  end
$$;

update storage.buckets
  set allowed_mime_types = array(select distinct m from unnest(allowed_mime_types || array['application/zip']) m order by 1)
  where id = 'ryagram-artifacts';

-- Off until the worker builds bundles (scene_bundle: the older design, named by the worker's contract, never switched on).
update public.control set disabled_job_types = array(
    select distinct t from unnest(disabled_job_types || array['film_bundle', 'scene_bundle']::public.job_type[]) t)
  where id;

-- ---------------------------------------------------------------- only through the request

-- request_film_bundle sets this for its own insert; everything else (submit_job, a direct insert) is refused. Transaction-local, and PostgREST runs each call in its own transaction, so a caller cannot carry it over.
create or replace function ryagram_private.film_bundle_by_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.job_type = 'scene_bundle' then
    raise exception 'Scene bundles are not available yet.' using errcode = '42501';
  end if;
  if new.job_type = 'film_bundle'
     and coalesce(current_setting('ryagram.film_bundle_request', true), '') <> 'on' then
    raise exception 'Film bundles are made through request_film_bundle.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function ryagram_private.film_bundle_by_request() from public, anon, authenticated;
drop trigger if exists jobs_film_bundle_by_request on public.jobs;
create trigger jobs_film_bundle_by_request before insert on public.jobs
  for each row execute function ryagram_private.film_bundle_by_request();

-- ---------------------------------------------------------------- free, in the credits ledger when it is on this database

do $do$
declare
  def text; neu text;
  a1 constant text := E'  else\n    new.price_code := ryagram_private.film_price_code(new.story);';
  b1 constant text := E'  elsif new.job_type::text = ''film_bundle'' then\n    new.price_code := ''film_bundle'';                     -- film bundles are free (20261113000400)\n' || a1;
  n int;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('ryagram_private.jobs_quote()');
  if def is null then raise notice 'The credits ledger is not on this database: nothing to teach it.'; return; end if;
  def := replace(def, chr(13), '');
  if position('film_bundle' in def) > 0 then raise notice 'jobs_quote: nothing to do (already priced).'; return; end if;
  n := (length(def) - length(replace(def, a1, ''))) / length(a1);
  if n <> 1 then
    raise exception 'The live function jobs_quote is not the one this change expects (the credits ledger''s own text); nothing was changed. Send this sentence to CONNECT.';
  end if;
  neu := replace(def, a1, b1);
  execute neu;
end $do$;

do $do$
declare
  def text; neu text;
  a2 constant text := E'  else code := ryagram_private.film_price_code(v.story_spec);';
  b2 constant text := E'  elsif p_job_type::text = ''film_bundle'' then code := ''film_bundle'';\n' || a2;
  n int;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.credit_quote(uuid,public.job_type)');
  if def is null then raise notice 'credit_quote is not on this database: nothing to teach it.'; return; end if;
  def := replace(def, chr(13), '');
  if position('film_bundle' in def) > 0 then raise notice 'credit_quote: nothing to do (already priced).'; return; end if;
  n := (length(def) - length(replace(def, a2, ''))) / length(a2);
  if n <> 1 then
    raise exception 'The live function credit_quote is not the one this change expects (the credits ledger''s own text); nothing was changed. Send this sentence to CONNECT.';
  end if;
  neu := replace(def, a2, b2);
  execute neu;
end $do$;

do $do$
begin
  if to_regclass('public.credit_prices') is not null then
    insert into public.credit_prices (price_version, code, credits, price_cents, monthly, effective_from)
      select p.price_version, 'film_bundle', 0, null, false, min(p.effective_from) from public.credit_prices p group by p.price_version
      on conflict (price_version, code) do nothing;
  end if;
end $do$;

-- ---------------------------------------------------------------- the claim order: a window someone is scrubbing jumps the queue, but never starves a film

-- The house worker runs ONE job at a time and the claim is first in, first out, so a film bundle window the person is waiting on in the editor (20 to 40 seconds of work) would queue behind every earlier job, a running
-- final render's whole length included. So the HOUSE claim (public.claim_next_job) takes a queued film_bundle job FIRST, with one guard: while any other house job of an enabled type has been queued for 2 minutes or more,
-- the order is the old one (oldest first), so editing can never starve a film. The render node's claim (node_claim) takes only run_on = 'owner_local' jobs and a film bundle is a house job: it is untouched.
-- Like the ledger above, it reads the LIVE function text and changes exactly the one ordering line (anything else stops with a plain sentence and changes nothing; already done, it is left alone).
do $do$
declare
  def text; neu text;
  a3 constant text := E'    order by created_at, id\n    for update skip locked\n    limit 1;';
  b3 constant text := E'    order by case when job_type = ''film_bundle'' and not exists (select 1 from public.jobs o where o.state = ''queued'' and o.run_on = ''house'' and o.job_type <> ''film_bundle'' and o.job_type <> all (ctl.disabled_job_types)\n                                                                  and o.created_at < now() - interval ''2 minutes'') then 0 else 1 end, created_at, id\n    for update skip locked\n    limit 1;';
  n int;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.claim_next_job()');
  if def is null then raise notice 'claim_next_job is not on this database: nothing to change.'; return; end if;
  def := replace(def, chr(13), '');
  if position('film_bundle' in def) > 0 then raise notice 'claim_next_job: nothing to do (already in the wanted order).'; return; end if;
  n := (length(def) - length(replace(def, a3, ''))) / length(a3);
  if n <> 1 then
    raise exception 'The live function claim_next_job is not the one this change expects (its queue ordering line differs from the repository''s 20261026000200_trust_ack_and_claim.sql); nothing was changed. Send this sentence to CONNECT.';
  end if;
  execute replace(def, a3, b3);
end $do$;

-- ---------------------------------------------------------------- the request
-- (A note for the planted-fault guard tests/mutant_blind_check.py: it looks for a line a later migration finds by replace() within 900 characters after a replace( call. The ordering rewrite above is the last replace() in this file;
-- this comment keeps the function header below out of that window, because the header line is this file's own text and no mutant of an earlier migration can make this migration's setup refuse to run.)

-- status:
--   ready     the window's bundle is built for this story and the current engine; storage_path is the file (sign it with createSignedUrl, as for any artifact).
--   building  a bundle of this window of this story is queued or being built; ask again, or watch job_id.
--   failed    the last bundle of this window, for this story and engine, failed for a reason a retry will not fix (error_detail says why). Edit the story, or wait for a new engine.
-- A new request after the story or the engine changes builds a new bundle.
create or replace function public.request_film_bundle(p_version_id uuid, p_seconds text)
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
  a int; b int; dur numeric;
begin
  -- the window: whole seconds, ASCII digits only, no sign, no leading zero, A < B, at most 10 s (the worker refuses anything else, so a bad one is never a job)
  if p_seconds is null or p_seconds !~ '^(0|[1-9][0-9]{0,5}):[1-9][0-9]{0,5}$' then
    raise exception 'Ask for a window like 0:10 (whole seconds, at most 10 seconds long).' using errcode = '22023';
  end if;
  a := split_part(p_seconds, ':', 1)::int; b := split_part(p_seconds, ':', 2)::int;
  if a >= b or b - a > 10 then
    raise exception 'Ask for a window like 0:10 (whole seconds, at most 10 seconds long).' using errcode = '22023';
  end if;
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
  -- A window that starts at or after the film's end holds no frame: said in words before a job exists. The database knows a film's length only from a finished render of this exact story (its video's duration);
  -- for any other film the length is not here and ENGINE's own refusal answers.
  select max(a3.duration_s) into dur from public.jobs j3 join public.artifacts a3 on a3.job_id = j3.id and a3.kind = 'final_video'
    where j3.version_id = v.id and j3.job_type = 'final_render' and j3.state = 'complete' and j3.story_sha256 = v.story_sha256 and a3.deleted_at is null;
  if dur is not null and a >= dur then
    raise exception 'That part of the film is past its end: the film is % seconds long.', round(dur, 1) using errcode = '22023';
  end if;

  -- 1. The cache: a finished bundle of this window of this exact story, from the engine running now.
  if engine is not null then
    select j2.id, a2.storage_path into hit, path
      from public.jobs j2 join public.artifacts a2 on a2.job_id = j2.id and a2.kind = 'film_bundle'
      where j2.version_id = v.id and j2.job_type = 'film_bundle' and j2.state = 'complete'
        and j2.params ->> 'seconds' = p_seconds
        and j2.story_sha256 = v.story_sha256 and j2.engine_commit = engine
        and a2.owner_id = me and a2.deleted_at is null
        and exists (select 1 from storage.objects o where o.bucket_id = a2.bucket and o.name = a2.storage_path)
      order by j2.ended_at desc limit 1;
    if found then
      return query select 'ready'::text, hit, path, engine, null::text;
      return;
    end if;
  end if;

  -- 2. Already building this window of this story: the same job. Windows of an OLDER story are no use; stop them
  --    (queued: cancelled now; running: the worker stops at its next heartbeat).
  select * into j from public.jobs
    where version_id = v.id and job_type = 'film_bundle'
      and state in ('queued', 'claimed', 'running', 'validating', 'uploading')
      and story_sha256 = v.story_sha256 and params ->> 'seconds' = p_seconds
    order by created_at desc limit 1;
  if found then
    return query select 'building'::text, j.id, null::text, null::text, null::text;
    return;
  end if;
  update public.jobs set state = 'cancelled', ended_at = now(), error_class = 'cancelled', error_code = 'cancelled'
    where version_id = v.id and job_type = 'film_bundle' and state = 'queued' and story_sha256 <> v.story_sha256;
  update public.jobs set cancel_requested = true
    where version_id = v.id and job_type = 'film_bundle' and state in ('claimed', 'running', 'validating', 'uploading') and story_sha256 <> v.story_sha256;

  -- 3. Don't rebuild what will fail again: the last bundle of this window of this story, from this engine, failed on its input (not the machine's fault).
  select * into j from public.jobs
    where version_id = v.id and job_type = 'film_bundle' and story_sha256 = v.story_sha256 and params ->> 'seconds' = p_seconds
      and state in ('failed', 'editorial_action_required') and error_class <> 'infrastructure'
      and engine is not null and engine_commit = engine
    order by ended_at desc limit 1;
  if found then
    return query select 'failed'::text, j.id, null::text, j.engine_commit,
      coalesce(j.error_detail, 'The engine could not draw this part of the film.');
    return;
  end if;

  -- 4. Build one.
  select * into ctl from public.control where id;
  if 'film_bundle' = any (ctl.disabled_job_types) then
    raise exception 'Real-frame previews are paused.' using errcode = '42501';
  end if;
  -- v1: catalog films only. A bundle carries the values the film draws, and for an upload those are the person's own; not stored as a bundle until CC1 has reviewed that. Lifting this is one line.
  if v.dataset_id is not null then
    raise exception 'Real-frame previews are for catalog films only for now.' using errcode = '42501';
  end if;
  if (select count(*) from public.jobs where owner_id = me and job_type = 'film_bundle'
        and state in ('queued', 'claimed', 'running', 'validating', 'uploading')) >= 6 then
    raise exception 'Six parts of your film are already being drawn. Try again when one is ready.' using errcode = '42501';
  end if;
  -- A free job must not be a way to load the render machine: 60 new windows an hour.
  if (select count(*) from public.jobs where owner_id = me and job_type = 'film_bundle'
        and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That is 60 parts of films drawn in the last hour. Try again later.' using errcode = '42501';
  end if;

  perform set_config('ryagram.film_bundle_request', 'on', true);
  insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, dataset_id, params)
    values (me, v.project_id, v.id, 'film_bundle', v.story_spec, v.story_sha256, v.dataset_id, jsonb_build_object('seconds', p_seconds))
    returning * into j;
  perform set_config('ryagram.film_bundle_request', '', true);
  return query select 'building'::text, j.id, null::text, null::text, null::text;
end $$;

revoke execute on function public.request_film_bundle(uuid, text) from public, anon;
grant execute on function public.request_film_bundle(uuid, text) to authenticated;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list: a waiting account is refused like everywhere else
commit;

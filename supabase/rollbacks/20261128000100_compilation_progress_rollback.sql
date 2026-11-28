-- UNDO of 20261128000100_compilation_progress.sql (BUILDER 2026-11-27). Puts public.node_compilation_report (8 arguments) and public.my_compilation_get back EXACTLY as
-- 20261127000300_compilations_for_everyone.sql wrote them (copied from that file, lines 211-228 and 230-308), drops the 11-argument form and the three progress columns.
-- Undo the node function FIRST if it was redeployed from builder-compilation-progress-1127 (redeploy node from 7974d08c): the newer node calls the 11-argument form.
-- CONNECT's progress read (its later migration) must be undone before this, or its status read names columns that are gone.
-- After it, live step 85 says STOP and live step 81 still says PASS.
-- UNDO ORDER: this file BEFORE 20261127000300's own rollback (that one does not know the 11-argument form, which would survive it).
begin;

-- the 8-argument form becomes the whole function again (it is plpgsql in 000300; create or replace may change the language and keeps the grants)
create or replace function public.node_compilation_report(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text,
                                               p_matches int default null, p_clips int default null, p_film_seconds numeric default null, p_error_code text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); run public.compilation_runs; started int; started_any int;
        codes constant text[] := array['request_invalid', 'song_request', 'folder_not_chosen', 'folder_missing', 'folder_empty', 'folders_overlap', 'no_speech', 'not_said', 'edit_failed', 'build_failed', 'crash'];   -- the closed list the app reports (FACES docs/COMPILATION-REPORT-1127.md; WEB and CONNECT word the same eleven)
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  perform ryagram_private.node_user_hit(me, 'compilation_report', 600, 3600);
  if p_state is null or p_state not in ('planning', 'matching', 'building', 'done', 'failed', 'cancelled') then
    raise exception 'That is not a compilation state.' using errcode = '22023';
  end if;
  if p_error_code = 'stale' then
    raise exception 'That reason is set by Ryagram itself, never by the computer.' using errcode = '22023';
  end if;
  if p_error_code is not null and p_error_code <> all (codes) then
    raise exception 'That is not a reason Ryagram knows for a build to stop.' using errcode = '22023';
  end if;
  if p_state = 'failed' and p_error_code is null then
    raise exception 'A failed build needs its reason.' using errcode = '22023';
  end if;
  if p_state <> 'failed' and p_error_code is not null then
    raise exception 'Only a failed build has a reason.' using errcode = '22023';
  end if;
  if p_matches not between 0 and 100000 or p_clips not between 0 and 100000 then
    raise exception 'The matches and clips are whole numbers from 0 to 100000.' using errcode = '22023';
  end if;
  if p_film_seconds not between 0 and 86400 then
    raise exception 'The film length is 0 to 86400 seconds.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compilation:' || me::text, 0));
  -- a build silent for 2 hours (a computer switched off mid-build) never blocks the next one
  update public.compilation_runs set state = 'failed', error_code = 'stale', ended_at = now(), updated_at = now()
   where owner_id = me and state in ('planning', 'matching', 'building') and updated_at < now() - interval '2 hours';
  select * into run from public.compilation_runs where owner_id = me and state in ('planning', 'matching', 'building') for update;
  if run.id is not null and (run.project_id <> p_project or run.request_sha256 <> p_request_sha256) then
    raise exception 'Another compilation is still being made on your computer. Let it finish or cancel it first.' using errcode = '55000';
  end if;
  if run.id is null then
    if p_state in ('done', 'failed', 'cancelled') then
      raise exception 'There is no build running for this request: a new build starts with planning.' using errcode = '22023';
    end if;
    if p_state <> 'planning' then
      raise exception 'There is no build running for this request: a new build starts with planning, even after one ended.' using errcode = '22023';
    end if;
    -- only a NEW build must be for the project's current request; a build already running keeps its own (the person may edit the request meanwhile)
    if not exists (select 1 from public.compilation_requests r join public.projects p on p.id = r.project_id
                    where r.project_id = p_project and r.owner_id = me and p.owner_id = me and r.request_sha256 = p_request_sha256) then
      raise exception 'That request is not the project''s current one. Load it again.' using errcode = 'PT404';
    end if;
    -- the 30 a day count REAL builds: a plan that stopped on a request or folder problem (the person fixes a folder and tries again) does not use one up (BUILDER 11-27);
    -- every run of any kind still counts toward a looser 200 a day, so planning spam stays bounded
    select count(*) filter (where not (state = 'failed' and matches is null and clips is null and error_code in ('request_invalid', 'song_request', 'folder_not_chosen', 'folder_missing', 'folder_empty', 'folders_overlap'))), count(*)
      into started, started_any from public.compilation_runs where owner_id = me and started_at > now() - interval '24 hours';
    if started_any >= 200 then
      raise exception 'This account has started 200 builds in the last 24 hours. Try again tomorrow.' using errcode = 'PT429';
    end if;
    if started >= 30 then
      raise exception 'You have started 30 compilations in the last 24 hours. Try again later.' using errcode = 'PT429';
    end if;
    insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code)
      values (me, p_project, p_request_sha256, p_state, p_matches, p_clips, p_film_seconds, p_error_code)
      returning * into run;
    return run.id;
  end if;
  -- the SAME state again is a HEARTBEAT (FACES 11-27; the app sends one during a long matching or building, or retries a report it is not sure arrived): the same run id back,
  -- updated_at refreshed (so a build longer than 2 hours never goes stale while its computer is on), newer counts taken if given; only going BACK is refused
  if array_position(array['planning', 'matching', 'building'], p_state) < array_position(array['planning', 'matching', 'building'], run.state) then
    raise exception 'That compilation has already moved past %.', p_state using errcode = '22023';
  end if;
  update public.compilation_runs
     set state = p_state, matches = coalesce(p_matches, matches), clips = coalesce(p_clips, clips), film_seconds = coalesce(p_film_seconds, film_seconds),
         error_code = case when p_state = 'failed' then p_error_code else null end, updated_at = now(),
         ended_at = case when p_state in ('done', 'failed', 'cancelled') then now() end
   where id = run.id;
  return run.id;
end $$;

drop function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text, int, int, int);

create or replace function public.my_compilation_get(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session();
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compilation:' || me::text, 0));
  update public.compilation_runs set state = 'failed', error_code = 'stale', ended_at = now(), updated_at = now()
   where owner_id = me and state in ('planning', 'matching', 'building') and now() - updated_at > interval '2 hours';
  return (select jsonb_build_object('request', r.request, 'sha256', r.request_sha256, 'updated_at', r.updated_at,
                 'run', (select jsonb_build_object('id', c.id, 'state', c.state, 'matches', c.matches, 'clips', c.clips, 'film_seconds', c.film_seconds,
                                                  'error_code', c.error_code, 'started_at', c.started_at, 'updated_at', c.updated_at, 'ended_at', c.ended_at,
                                                  'current', c.request_sha256 = r.request_sha256)
                           from public.compilation_runs c where c.owner_id = me and c.project_id = r.project_id order by c.id desc limit 1))
            from public.compilation_requests r join public.projects p on p.id = r.project_id
           where r.project_id = p_project and r.owner_id = me and p.owner_id = me);
end $$;

alter table public.compilation_runs
  drop constraint compilation_runs_progress_only_running,
  drop constraint compilation_runs_percent_range,
  drop constraint compilation_runs_step_done_range,
  drop constraint compilation_runs_step_total_range,
  drop column percent,
  drop column step_total,
  drop column step_done;

do $do$
begin
  if exists (select 1 from pg_proc where proname = 'node_compilation_report' and prosrc like '%p_step%')
     or exists (select 1 from pg_proc where proname = 'my_compilation_get' and prosrc like '%step_done%') then
    raise exception 'The progress undo left a function that still names the progress numbers; nothing was changed.';
  end if;
end $do$;

select ryagram_private.gate_apply();
commit;

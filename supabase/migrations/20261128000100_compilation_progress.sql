-- COMPILATION PROGRESS, COUNTS ONLY (BUILDER 2026-11-27 23:1x, NOT APPLIED). Ryan's mid-test finding (Claude 23:06): while Plan and Build run, nobody can tell anything is happening.
-- The app shows the file name and that video's own percent on the person's PC ONLY; the server is told THREE WHOLE NUMBERS and nothing else (contract: BUILDER 23:12, CONNECT 23:11):
--   step_done, step_total : in planning and matching the step is a VIDEO (video step_done of step_total); in building it is a CLIP (clip step_done of step_total)
--   percent               : the overall estimate for the whole build, 0 to 100
-- RULES
--   * each OPTIONAL; step_total 0 to 1000; step_done 0 to step_total and only together with step_total; percent 0 to 100; whole numbers only (the node route refuses anything else with a 400)
--   * the three are ONE SET: a report that gives any of them replaces all three (a missing one becomes null); a report that gives none keeps them in the same state and clears them on a new state
--   * kept ONLY while the build is planning, matching or building; done, failed, cancelled and stale clear them (a table check says so), and an end-state report that carries them is refused
--   * no new limit: the existing 600 reports an hour per account (and 120 a minute per computer on the node route) stand
--   * no name, no folder, no path, no word: three integers
-- WHAT CHANGES
--   (1) public.compilation_runs gains step_done, step_total, percent (nullable ints with checks)
--   (2) public.node_compilation_report gains an 11-argument form with the three; the 8-argument form (live since 000300) becomes a thin call of it with three nulls, so the node function deployed tonight
--       (7974d08c, which sends 8) keeps working unchanged, before and after this file
--   (3) public.my_compilation_get's run gains step_done, step_total, percent; its stale close clears them
-- Apply AFTER 20261127000300_compilations_for_everyone.sql (applied live 11-27 22:2x, blob c4e48e86). Then deploy node from builder-compilation-progress-1127 (router.ts, db.ts, types.ts, fake.ts).
-- CONNECT's connect_compilation_status reads these three in its own later migration (CONNECT 23:11). Credits: none.
-- Undo: rollbacks/20261128000100_compilation_progress_rollback.sql (puts both functions back exactly as 000300 wrote them, drops the 11-argument form and the three columns). Check: live-steps/85_compilation_progress_check.sql.
begin;

alter table public.compilation_runs
  add column step_done int,
  add column step_total int,
  add column percent int,
  add constraint compilation_runs_step_total_range check (step_total between 0 and 1000),
  add constraint compilation_runs_step_done_range check (step_done is null or (step_total is not null and step_done between 0 and step_total)),
  add constraint compilation_runs_percent_range check (percent between 0 and 100),
  add constraint compilation_runs_progress_only_running check (state in ('planning', 'matching', 'building') or (step_done is null and step_total is null and percent is null));

create function public.node_compilation_report(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text,
                                               p_matches int, p_clips int, p_film_seconds numeric, p_error_code text,
                                               p_step_done int, p_step_total int, p_percent int)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); run public.compilation_runs; started int; started_any int;
        given boolean := p_step_done is not null or p_step_total is not null or p_percent is not null;
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
  -- PROGRESS, three whole numbers (BUILDER 23:12)
  if given and p_state in ('done', 'failed', 'cancelled') then
    raise exception 'Progress is only sent while a build is running.' using errcode = '22023';
  end if;
  if p_step_total not between 0 and 1000 then
    raise exception 'The step total is a whole number from 0 to 1000.' using errcode = '22023';
  end if;
  if p_step_done is not null and (p_step_total is null or p_step_done not between 0 and p_step_total) then
    raise exception 'The step done is a whole number from 0 to the step total, sent with it.' using errcode = '22023';
  end if;
  if p_percent not between 0 and 100 then
    raise exception 'The percent is a whole number from 0 to 100.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compilation:' || me::text, 0));
  -- a build silent for 2 hours (a computer switched off mid-build) never blocks the next one
  update public.compilation_runs set state = 'failed', error_code = 'stale', ended_at = now(), updated_at = now(), step_done = null, step_total = null, percent = null
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
    insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code, step_done, step_total, percent)
      values (me, p_project, p_request_sha256, p_state, p_matches, p_clips, p_film_seconds, p_error_code, p_step_done, p_step_total, p_percent)
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
         ended_at = case when p_state in ('done', 'failed', 'cancelled') then now() end,
         -- progress is ONE SET: given = all three replaced; not given = kept in the same state, cleared on a new state; an end state clears it
         step_done  = case when p_state in ('done', 'failed', 'cancelled') then null when given then p_step_done  when p_state = run.state then step_done  end,
         step_total = case when p_state in ('done', 'failed', 'cancelled') then null when given then p_step_total when p_state = run.state then step_total end,
         percent    = case when p_state in ('done', 'failed', 'cancelled') then null when given then p_percent    when p_state = run.state then percent    end
   where id = run.id;
  return run.id;
end $$;
revoke execute on function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text, int, int, int) from public, anon, authenticated, service_role;
grant execute on function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text, int, int, int) to node_runner;

-- the 8-argument form the deployed node function calls: the same call with no progress (its grants are kept by create or replace)
create or replace function public.node_compilation_report(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text,
                                               p_matches int default null, p_clips int default null, p_film_seconds numeric default null, p_error_code text default null)
returns bigint
language sql security definer set search_path = '' as $$
  select public.node_compilation_report(p_access_hash, p_project, p_request_sha256, p_state, p_matches, p_clips, p_film_seconds, p_error_code, null::int, null::int, null::int)
$$;

-- NOT stable (WORKER 11-27 MEDIUM 3): a read closes a build silent for 2 hours as failed 'stale', in this transaction, the same way the report does, so the page shows the stale
-- sentence while the computer is off (it never reports again to close it). Same lock as the report, so a report and a read never race. Now also the three progress numbers.
create or replace function public.my_compilation_get(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session();
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compilation:' || me::text, 0));
  update public.compilation_runs set state = 'failed', error_code = 'stale', ended_at = now(), updated_at = now(), step_done = null, step_total = null, percent = null
   where owner_id = me and state in ('planning', 'matching', 'building') and now() - updated_at > interval '2 hours';
  return (select jsonb_build_object('request', r.request, 'sha256', r.request_sha256, 'updated_at', r.updated_at,
                 'run', (select jsonb_build_object('id', c.id, 'state', c.state, 'matches', c.matches, 'clips', c.clips, 'film_seconds', c.film_seconds,
                                                  'error_code', c.error_code, 'started_at', c.started_at, 'updated_at', c.updated_at, 'ended_at', c.ended_at,
                                                  'current', c.request_sha256 = r.request_sha256,
                                                  'step_done', c.step_done, 'step_total', c.step_total, 'percent', c.percent)
                           from public.compilation_runs c where c.owner_id = me and c.project_id = r.project_id order by c.id desc limit 1))
            from public.compilation_requests r join public.projects p on p.id = r.project_id
           where r.project_id = p_project and r.owner_id = me and p.owner_id = me);
end $$;

select ryagram_private.gate_apply();
commit;

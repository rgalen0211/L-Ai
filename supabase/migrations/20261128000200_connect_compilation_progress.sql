-- COMPILATION PROGRESS, COUNTS ONLY, FOR THE PERSON'S AI (CONNECT, 2026-11-27 23:xx). NOT APPLIED: Ryan applies it. No Postgres was run for it (node tests only).
-- Ryan's mid-test finding (Claude 23:06): while Plan and Build run, nobody can tell anything is happening. BUILDER's contract (23:12, confirmed by CONNECT 23:11): a compilation run carries THREE OPTIONAL WHOLE NUMBERS and nothing else:
--   step_done, step_total : in planning and matching the step is a VIDEO (video step_done of step_total); in building it is a CLIP (clip step_done of step_total)
--   percent               : the overall estimate for the whole build, 0 to 100
--   step_total 0 to 1000; step_done 0 to step_total and only together with step_total; percent 0 to 100; kept by the server only while the build is planning, matching or building (null at done, failed, cancelled, stale).
-- THIS FILE NEEDS BUILDER'S 20261128000100_compilation_progress.sql FIRST: it adds the three columns to public.compilation_runs (branch builder-compilation-progress-1127). It is written so that applying it BEFORE his file is harmless
-- (the three answer null, never an error: the columns are read as keys of the row's own jsonb, so a missing column is a null), but it then shows nothing until his columns exist.
-- WHAT CHANGES: ONE function, public.connect_compilation_get(text, uuid), replaced with the same signature, the same grants (the connector login only), security definer, empty search_path. Its run gains step_done, step_total, percent.
--   * each is a WHOLE NUMBER or null: a value that is not a number (text, a name, a path), not whole, negative or out of range is answered as null, never clamped into range and never returned as text;
--   * step_total is 0 to 1000; step_done is 0 to step_total and null when step_total is null or smaller than it; percent is 0 to 100;
--   * all three are null unless the run's state is planning, matching or building (an end state, or a state this file does not know, shows none even if a row still held them);
--   * all three keys are ALWAYS present in the run (null when absent), so the answer has one shape.
-- Everything else in connect_compilation_get is copied exactly from 20261127000400_connect_compilation_status.sql (blob 806c847f): the gate (connect_compilations_open), the token check (connect_actor, scope read), the project check, the request, the other run fields.
-- connect_compilations_open and connect_set_compilation_request are NOT touched. No new table, no new grant, no write.
-- DEPLOY ORDER: apply BUILDER's 20261128000100 first, then this file, then deploy the `connect` function (an older connector ignores the three keys; a newer one on an older database sees none and says nothing extra).
-- Undo: supabase/rollbacks/20261128000200_connect_compilation_progress_rollback.sql (puts connect_compilation_get back exactly as 20261127000400 made it). Check: supabase/live-steps/86_connect_compilation_progress_check.sql.

begin;

create or replace function public.connect_compilation_get(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  req_json jsonb; req_sha text; req_at timestamptz;
  run jsonb := null;
  prog jsonb; sd_text text; st_text text; pc_text text;
  sd int := null; st int := null; pc int := null;
begin
  if not ryagram_private.connect_compilations_open(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.owner_id = me) then
    return null;                                                    -- not the person's project: the tool answers "not found"
  end if;
  select r.request, r.request_sha256, r.updated_at into req_json, req_sha, req_at
    from public.compilation_requests r where r.project_id = p_project and r.owner_id = me;
  if req_json is null then
    return jsonb_build_object('request', null, 'sha256', null, 'updated_at', null, 'run', null);
  end if;
  if to_regclass('public.compilation_runs') is not null then
    begin
      -- the three progress values are read as keys of the row's own jsonb (to_jsonb(c) -> 'name'): a column that does not exist yet (BUILDER's 20261128000100 not applied) is a null, not an error
      execute 'select jsonb_build_object(''id'', c.id, ''state'', c.state, ''matches'', c.matches, ''clips'', c.clips, ''film_seconds'', c.film_seconds, ''error_code'', c.error_code, '
              || '''started_at'', c.started_at, ''updated_at'', c.updated_at, ''ended_at'', c.ended_at, ''current'', c.request_sha256 = $3, '
              || '''progress'', jsonb_build_object(''step_done'', to_jsonb(c) -> ''step_done'', ''step_total'', to_jsonb(c) -> ''step_total'', ''percent'', to_jsonb(c) -> ''percent'')) '
              || 'from public.compilation_runs c where c.project_id = $1 and c.owner_id = $2 order by c.started_at desc nulls last, c.id desc limit 1'
        into run using p_project, me, req_sha;
    exception when undefined_column or undefined_function then
      run := null;                                                  -- a table with other column names: no report is shown, the after-check says why
    end;
  end if;
  if run is not null then
    prog := run -> 'progress';
    run := run - 'progress';
    if run ->> 'state' in ('planning', 'matching', 'building') then      -- only while it runs; any other state shows none
      -- only a JSON NUMBER written as a plain whole number counts (so text, a name, a path, 2.5 and -3 are all null); then the ranges
      st_text := case when jsonb_typeof(prog -> 'step_total') = 'number' then prog ->> 'step_total' end;
      if case when st_text ~ '^[0-9]{1,4}$' then st_text::int <= 1000 else false end then st := st_text::int; end if;       -- CASE, not AND: the cast must never run on text that is not a whole number
      sd_text := case when jsonb_typeof(prog -> 'step_done') = 'number' then prog ->> 'step_done' end;
      if case when st is not null and sd_text ~ '^[0-9]{1,4}$' then sd_text::int <= st else false end then sd := sd_text::int; end if;       -- step_done only together with a valid step_total, never above it
      pc_text := case when jsonb_typeof(prog -> 'percent') = 'number' then prog ->> 'percent' end;
      if case when pc_text ~ '^[0-9]{1,3}$' then pc_text::int <= 100 else false end then pc := pc_text::int; end if;
    end if;
    run := run || jsonb_build_object('step_done', sd, 'step_total', st, 'percent', pc);
  end if;
  return jsonb_build_object('request', req_json, 'sha256', req_sha, 'updated_at', req_at, 'run', run);
end $$;

revoke execute on function public.connect_compilation_get(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.connect_compilation_get(text, uuid) to connect_runner;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (the function is the connector login's only, so the gate leaves it as it is)
commit;

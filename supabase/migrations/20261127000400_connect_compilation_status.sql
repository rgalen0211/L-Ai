-- THE COMPILATIONS DEPARTMENT FOR THE PERSON'S AI (CONNECT, 2026-11-27): where a compilation stands (connect_compilation_get) and the same gate on the AI's writer (connect_set_compilation_request). NOT APPLIED: Ryan applies it.
-- A compilation is found and built on the PERSON'S OWN computer, from clips that never leave it. The site holds only two small things: the request (public.compilation_requests, data only: the words, folder NAMES, switches) and, from
-- BUILDER's migration 20261127000300, the reports that computer sends back (public.compilation_runs: a state and counts; no path, no transcript, no video). The site's own page reads both through public.my_compilation_get (a signed-in
-- session). The AI has no session: it holds a token the person gave it. So connect_compilation_get(p_token_hash, p_project) is the token-checked twin: it resolves the person from the token on every call (connect_actor, scope 'read'),
-- takes no owner argument, and answers {request, sha256, updated_at, run} for ONE project of THAT person, or null for a project that is not theirs (it looks absent). It reads two tables, writes nothing, starts nothing, touches no credit.
--   request  = the saved request as written (jsonb) or null when none is saved yet; sha256 and updated_at are that row's.
--   run      = the NEWEST report for that project (by started_at), or null when the person's computer has reported nothing: {id, state, matches, clips, film_seconds, error_code, started_at, updated_at, ended_at, current};
--              current = the report was made for the request as it is saved NOW. (The same shape BUILDER's my_compilation_get answers.)
-- THE GATE (ONE rule, shared with the site and the computer: GEO's 09:18 review asked that the AI cannot save what the site and the PC then refuse). ryagram_private.connect_compilations_open(person) is used by BOTH functions:
--   * WHEN BUILDER's ryagram_private.compilations_on(person) EXISTS (looked up with to_regprocedure), IT IS THE RULE: the account's 'compilations' switch, or the department opened for everyone (his migration 20261127000300). An
--     administrator is open only if compilations_on says so. ONE DOOR IS KEPT (see below): an invited tester (account_settings.local_compute).
--   * WHEN IT DOES NOT EXIST YET, today's rule: an invited tester (local_compute) or an administrator. So this migration applies and works before his does.
--   THE TESTER DOOR: BUILDER's compilations_on (origin/builder-compilations-server-1127 3a43a044, and department_switch_on in builder-dept-switches-1127) does NOT cover account_settings.local_compute. Ryan's own tester account would
--   therefore be locked out of set_compilation_request the day his migration lands if the gate used compilations_on alone. So a tester stays open HERE. The cost, said plainly: a tester without the switch can save and read a request
--   through the AI, but the site's my_compilation_set and the computer's node_compilation_report refuse that account. The clean fix is one line on BUILDER's side: add `or local_compute` to compilations_on; then this door can go.
-- Otherwise the call is refused in words (42501, like the site's own calls) and nothing is read or written.
-- connect_set_compilation_request IS REPLACED with its live definition (20261026000300_compilation_requests.sql) copied exactly and TWO checks added: the gate right after the person is resolved, and, when BUILDER's
-- ryagram_private.compilation_request_problem(jsonb) exists (found by name, skipped when absent), the request must pass it (no file, path or link anywhere in it; 22023 in his plain words), so a path an AI writes cannot come back on the
-- site through my_compilation_get (BUILDER 09:17). Its signature, its grants (the connector login only) and every other behaviour are unchanged; today's invited testers keep working, a stranger no longer reaches a half-on department.
-- ORDER: needs 20261026000300_compilation_requests.sql (applied live 2026-10-27) and 20261018000100_connect_ai.sql. It does NOT need BUILDER's 20261127000300 / 20261127000250: until compilation_runs exists, `run` is null (guarded with
-- to_regclass, like connect_whoami's credit balances). compilation_runs columns read (BUILDER's final list): owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code, started_at, updated_at, ended_at, id;
-- a table with other column names gives run null, not an error, and the after-check says false.
-- DEPLOY ORDER: apply this migration BEFORE deploying the `connect` function (the connector treats a missing connect_compilation_get as "not available just now").
-- Undo: supabase/rollbacks/20261127000400_connect_compilation_status_rollback.sql (drops the new functions and puts connect_set_compilation_request back exactly as it was). Check: supabase/live-steps/66_connect_compilation_status_check.sql.

begin;

-- The one gate. Not callable by any API role: only the two definer functions below (which run as their owner) use it.
create function ryagram_private.connect_compilations_open(p_person uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare is_open boolean;
declare tester boolean;
begin
  tester := coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_person), false);
  if to_regprocedure('ryagram_private.compilations_on(uuid)') is not null then
    execute 'select ryagram_private.compilations_on($1)' into is_open using p_person;      -- BUILDER's rule is THE rule (administrators included only if it says yes) ...
    return coalesce(is_open, false) or tester;                                                -- ... plus the one tester door (header)
  end if;
  return tester or exists (select 1 from public.app_admins a where a.user_id = p_person);   -- his function is not there yet: today's rule
end $$;
revoke all on function ryagram_private.connect_compilations_open(uuid) from public, anon, authenticated, service_role;

create function public.connect_compilation_get(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  req_json jsonb; req_sha text; req_at timestamptz;
  run jsonb := null;
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
      execute 'select jsonb_build_object(''id'', c.id, ''state'', c.state, ''matches'', c.matches, ''clips'', c.clips, ''film_seconds'', c.film_seconds, ''error_code'', c.error_code, '
              || '''started_at'', c.started_at, ''updated_at'', c.updated_at, ''ended_at'', c.ended_at, ''current'', c.request_sha256 = $3) '
              || 'from public.compilation_runs c where c.project_id = $1 and c.owner_id = $2 order by c.started_at desc nulls last, c.id desc limit 1'
        into run using p_project, me, req_sha;
    exception when undefined_column or undefined_function then
      run := null;                                                  -- a table with other column names: no report is shown, the after-check says why
    end;
  end if;
  return jsonb_build_object('request', req_json, 'sha256', req_sha, 'updated_at', req_at, 'run', run);
end $$;

revoke execute on function public.connect_compilation_get(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.connect_compilation_get(text, uuid) to connect_runner;

-- connect_set_compilation_request: the live definition (20261026000300_compilation_requests.sql), copied exactly, plus the one gate check after the person is resolved.
create or replace function public.connect_set_compilation_request(p_token_hash text, p_project uuid, p_request jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); sha text; why text;
begin
  if not ryagram_private.connect_compilations_open(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    return null;                                                    -- not the person's project: the tool answers "not found", and nothing is written
  end if;
  if jsonb_typeof(p_request) <> 'object' or p_request ->> 'schema' is distinct from 'ryagram.compilation-request/0' or octet_length(p_request::text) > 32768 then
    raise exception 'That request is not valid.' using errcode = '22023';
  end if;
  if to_regprocedure('ryagram_private.compilation_request_problem(jsonb)') is not null then      -- BUILDER's data-only rule (no file, path or link at any depth), when his migration is there
    execute 'select ryagram_private.compilation_request_problem($1)' into why using p_request;
    if why is not null then
      raise exception '%', why using errcode = '22023';
    end if;
  end if;
  sha := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
  insert into public.compilation_requests (project_id, owner_id, request, request_sha256) values (p_project, me, p_request, sha)
  on conflict (project_id) do update set request = excluded.request, request_sha256 = excluded.request_sha256, updated_at = now()
  where public.compilation_requests.owner_id = me;
  return sha;
end $$;

revoke all on function public.connect_set_compilation_request(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.connect_set_compilation_request(text, uuid, jsonb) to connect_runner;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (the functions are the connector login's only, so the gate leaves them as they are)
commit;

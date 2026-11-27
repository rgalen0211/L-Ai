-- WHERE A COMPILATION STANDS, FOR THE PERSON'S AI (CONNECT, 2026-11-27; the Compilations department's connector tool get_compilation_status). NOT APPLIED: a PROPOSAL for BUILDER and CC1; Ryan applies it. It ADDS one function and changes nothing.
-- A compilation is found and built on the PERSON'S OWN computer, from clips that never leave it. The site holds only two small things: the request (public.compilation_requests, data only: the words, folder NAMES, switches) and, from
-- BUILDER's migration 20261127000300, the reports that computer sends back (public.compilation_runs: a state and counts; no path, no transcript, no video). The site's own page reads both through public.my_compilation_get (a signed-in
-- session). The AI has no session: it holds a token the person gave it. So this is the token-checked twin: connect_compilation_get(p_token_hash, p_project) resolves the person from the token on every call (connect_actor,
-- scope 'read'), takes no owner argument, and answers {request, sha256, updated_at, run} for ONE project of THAT person, or null for a project that is not theirs (it looks absent). It reads two tables, writes nothing, starts nothing, touches no credit.
--   request  = the saved request as written (jsonb) or null when none is saved yet; sha256 and updated_at are that row's.
--   run      = the NEWEST report for that project, or null when the person's computer has reported nothing: {state, matches, clips, film_seconds, error_code, updated_at, current}; current = the report was made for the request as it is saved NOW.
-- THE SWITCH: Compilations are open for an account when ryagram_private.compilations_on(person) says so (BUILDER's migration: the site-wide lever OR 'compilations' in the account's switch list), OR by the rule that is live
-- today for compilation requests (an invited tester with local_compute, or an administrator). Otherwise the call is refused in words (22023) and nothing is read.
-- ORDER: needs 20261026000300_compilation_requests.sql and 20261018000100_connect_ai.sql. It does NOT need BUILDER's 20261127000300: until compilation_runs exists, `run` is simply null (guarded with to_regclass, like connect_whoami's credit balances),
-- and until compilations_on exists the older rule above alone decides. The column names read from compilation_runs are ASSUMED from BUILDER's 08:11 post (project_id, request_sha256, state, matches, clips, film_seconds, error_code, created_at, updated_at):
-- the after-check (supabase/live-steps/66_connect_compilation_status_check.sql) says false if the real table lacks any of them, and a missing column makes `run` null rather than an error.
-- Undo: supabase/rollbacks/20261127000400_connect_compilation_status_rollback.sql. Check: supabase/live-steps/66_connect_compilation_status_check.sql.

begin;

create function public.connect_compilation_get(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  is_open boolean;
  req_json jsonb; req_sha text; req_at timestamptz;
  run jsonb := null;
begin
  -- is the department open for this person? The rule that is live today for compilation requests (an invited tester or an administrator) keeps working; BUILDER's rule (the site-wide lever or the account switch) ADDS to it once it exists
  is_open := coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false)
          or exists (select 1 from public.app_admins a where a.user_id = me);
  if not is_open and to_regprocedure('ryagram_private.compilations_on(uuid)') is not null then
    execute 'select ryagram_private.compilations_on($1)' into is_open using me;
  end if;
  if not coalesce(is_open, false) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '22023';
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
      execute 'select jsonb_build_object(''state'', c.state, ''matches'', c.matches, ''clips'', c.clips, ''film_seconds'', c.film_seconds, ''error_code'', c.error_code, ''updated_at'', c.updated_at, ''current'', c.request_sha256 = $2) '
              || 'from public.compilation_runs c where c.project_id = $1 order by c.created_at desc limit 1'
        into run using p_project, req_sha;
    exception when undefined_column then
      run := null;                                                  -- a table with other column names: no report is shown, the after-check says why
    end;
  end if;
  return jsonb_build_object('request', req_json, 'sha256', req_sha, 'updated_at', req_at, 'run', run);
end $$;

revoke execute on function public.connect_compilation_get(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.connect_compilation_get(text, uuid) to connect_runner;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (the function is the connector login's only, so the gate leaves it as it is)
commit;

-- COMPILATIONS FOR EVERY USER, THE SERVER HALF (BUILDER 2026-11-27; Claude's 08:08 and 08:10 orders for Ryan: "find every time X says Y" from the person's own clips, the finished film stays on their own PC).
-- NOT APPLIED: Ryan applies it (live step 81). Undo: supabase/rollbacks/20261127000300_compilations_for_everyone_rollback.sql.
-- WHAT EXISTS AND STAYS: public.compilation_requests (one request per project, data only), written by the AI connector (connect_set_compilation_request) and read by the person's desktop app
--   (node_compilation_requests). The maker on the person's PC finds the phrase and builds the film; the site never receives a video, a sound, a path or a transcript.
-- WHAT THIS ADDS
--   (1) THE SWITCH: ryagram_private.compilations_on(person) is true when 'compilations' is in that account's per-account switch list (department_switch_on, 20261127000250; set only by
--       admin_account_switch_set), or when Ryan has opened the compilations department for everyone (live step 82a). A worker account is never on. Every new call below refuses in words when off.
--       The top bar follows the same rule (20261127000250 and 82a), so a person sees the department exactly when these calls work.
--   (2) ANY ACCOUNT WITH THE SWITCH CAN SIGN IN ITS OWN COMPUTER: public.device_decide refused everyone but a tester (local_compute); it now also lets an account with compilations on approve its
--       computer. Read from the LIVE text, one clause replaced; refused in words if that clause is not there exactly once. Such a computer claims NO job (node_claim refuses a non-tester),
--       but like a tester's computer it can read and write that person's OWN editor summaries, download plans and footage plans through the existing node_* calls (their own rows only).
--   (3) THE SITE'S OWN WRITE: public.my_compilation_set(project, request) (the person in the app, their own project, the connector's schema ryagram.compilation-request/0, at most 32 KB, NO path,
--       URL or file anywhere in it, at most 60 saves an hour) and public.my_compilation_get(project) (the request and the newest run report, or null).
--   (4) WHAT THE PC REPORTS BACK, DATA ONLY: public.compilation_runs (state, counts, seconds, an error code; no path, no transcript, no video), written ONLY by public.node_compilation_report through
--       the computer's own token (node_runner): a new build only for the project's CURRENT request, the running one always closable with its own; one active build per account, a build
--       silent for 2 hours closed as 'stale'; states only move forward; at most 30 builds started a day; 60 saves in any clock hour.
--   (5) CREDITS: none. A compilation runs on the person's own computer: nothing here reads or writes the credit ledger.
-- Apply AFTER: 20261127000250_department_switches.sql (department_switch_on), 20261026000300/400 (compilation requests), 20261021000100_r9_render_node.sql (device codes, node_actor, node_user_hit), 20261110000400_account_switches.sql (switches_on),
--   20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
begin;

-- ONE LEVER PER DEPARTMENT (CC1 08:10): on for an account whose 'compilations' switch is on (department_switch_on, 20261127000250), or for everyone once the compilations department is opened
-- for everyone (live step 82a: departments.status 'working' and needs_local_compute false). No second setting.
create function ryagram_private.compilations_on(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_person is not null
     and not exists (select 1 from public.workers w where w.user_id = p_person)
     and (ryagram_private.department_switch_on(p_person, 'compilations')
          or exists (select 1 from public.departments d where d.id = 'compilations' and d.status = 'working' and not d.needs_local_compute))
$$;
revoke execute on function ryagram_private.compilations_on(uuid) from public, anon, authenticated, service_role;

-- a request is DATA: refuse anything that names a file, a path or a link, at any depth
create function ryagram_private.compilation_request_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare t text; v text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p ->> 'schema' is distinct from 'ryagram.compilation-request/0' then
    return 'That compilation request is not valid.';
  end if;
  t := p::text;
  if octet_length(t) > 32768 then
    return 'That compilation request is too long.';
  end if;
  -- keys, at any depth (a key is rendered as "name": in the jsonb text)
  if t ~* '"([a-z_]*path[a-z_]*|urls?|uri|href|src|files?|filename|video|audio|dir|directory|location)"\s*:' then
    return 'A compilation request holds folder names and a phrase only, never a file, a path or a link.';
  end if;
  -- values: every string at any depth, UNESCAPED (so a newline or a tab before a path is a real character), invisible characters removed first
  select coalesce(string_agg(x #>> '{}', chr(10)), '') into v from jsonb_path_query(p, 'strict $.**') x where jsonb_typeof(x) = 'string';
  v := regexp_replace(v, '[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]', '', 'g');
  if v ~* '([a-z]:[\\/]|\\\\[a-z0-9]|(^|[^a-z0-9._-])/(users|home|mnt|volumes|private|tmp|var|media|etc|srv|opt|root)/|[a-z][a-z0-9+.-]*://|%2f|%5c|%3a|(^|\s)~[a-z0-9_]*[/\\]|%[a-z_]+%|\$home\y|[\uff0f\uff3c\u2215\uff1a])' then
    return 'A compilation request holds folder names and a phrase only, never a file, a path or a link.';
  end if;
  return null;
end $$;
revoke execute on function ryagram_private.compilation_request_problem(jsonb) from public, anon, authenticated, service_role;

create table public.compilation_runs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('planning', 'matching', 'building', 'done', 'failed', 'cancelled')),
  matches int check (matches between 0 and 100000),
  clips int check (clips between 0 and 100000),
  film_seconds numeric check (film_seconds between 0 and 86400),
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index compilation_runs_owner_idx on public.compilation_runs (owner_id, started_at desc);
create unique index compilation_runs_one_active on public.compilation_runs (owner_id) where state in ('planning', 'matching', 'building');
alter table public.compilation_runs enable row level security;
create policy compilation_runs_owner_read on public.compilation_runs for select to authenticated using (owner_id = auth.uid());
revoke all on public.compilation_runs from public, anon, authenticated, service_role;
grant select on public.compilation_runs to authenticated;

create function public.my_compilation_set(p_project uuid, p_request jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); why text; sha text;
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    raise exception 'Project not found.' using errcode = 'PT404';
  end if;
  why := ryagram_private.compilation_request_problem(p_request);
  if why is not null then
    raise exception '%', why using errcode = '22023';
  end if;
  perform ryagram_private.node_user_hit(me, 'compilation_set', 60, 3600);
  sha := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
  insert into public.compilation_requests (project_id, owner_id, request, request_sha256) values (p_project, me, p_request, sha)
  on conflict (project_id) do update set request = excluded.request, request_sha256 = excluded.request_sha256, updated_at = now()
  where public.compilation_requests.owner_id = me;
  return sha;
end $$;

create function public.my_compilation_get(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session();
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('request', r.request, 'sha256', r.request_sha256, 'updated_at', r.updated_at,
                 'run', (select jsonb_build_object('id', c.id, 'state', c.state, 'matches', c.matches, 'clips', c.clips, 'film_seconds', c.film_seconds,
                                                  'error_code', c.error_code, 'started_at', c.started_at, 'updated_at', c.updated_at, 'ended_at', c.ended_at,
                                                  'current', c.request_sha256 = r.request_sha256)
                           from public.compilation_runs c where c.owner_id = me and c.project_id = r.project_id order by c.id desc limit 1))
            from public.compilation_requests r join public.projects p on p.id = r.project_id
           where r.project_id = p_project and r.owner_id = me and p.owner_id = me);
end $$;

create function public.node_compilation_report(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text,
                                               p_matches int default null, p_clips int default null, p_film_seconds numeric default null, p_error_code text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); run public.compilation_runs; started int;
begin
  if not ryagram_private.compilations_on(me) then
    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('planning', 'matching', 'building', 'done', 'failed', 'cancelled') then
    raise exception 'That is not a compilation state.' using errcode = '22023';
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
      raise exception 'That compilation was not started.' using errcode = '22023';
    end if;
    -- only a NEW build must be for the project's current request; a build already running keeps its own (the person may edit the request meanwhile)
    if not exists (select 1 from public.compilation_requests r join public.projects p on p.id = r.project_id
                    where r.project_id = p_project and r.owner_id = me and p.owner_id = me and r.request_sha256 = p_request_sha256) then
      raise exception 'That request is not the project''s current one. Load it again.' using errcode = 'PT404';
    end if;
    select count(*) into started from public.compilation_runs where owner_id = me and started_at > now() - interval '24 hours';
    if started >= 30 then
      raise exception 'You have started 30 compilations in the last 24 hours. Try again later.' using errcode = 'PT429';
    end if;
    insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code)
      values (me, p_project, p_request_sha256, p_state, p_matches, p_clips, p_film_seconds, p_error_code)
      returning * into run;
    return run.id;
  end if;
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

revoke execute on function public.my_compilation_set(uuid, jsonb), public.my_compilation_get(uuid) from public, anon, service_role;
grant execute on function public.my_compilation_set(uuid, jsonb), public.my_compilation_get(uuid) to authenticated;
revoke execute on function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text) to node_runner;

-- (2) device_decide: an account with compilations on may approve its own computer too (live text, one clause)
do $do$
declare def text; o constant text := 'if p_approve and not coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) then';
        nw constant text := 'if p_approve and not (coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or ryagram_private.compilations_on(me)) then';
begin
  def := replace(pg_get_functiondef('public.device_decide(text, boolean)'::regprocedure), chr(13), '');
  if position(nw in def) > 0 then
    raise notice 'device_decide already lets a compilations account approve its computer, left alone.';
  elsif (length(def) - length(replace(def, o, ''))) / length(o) <> 1 then
    raise exception 'device_decide is not the one this change expects (its tester check differs from the repository); nothing was changed. Send this sentence to BUILDER.';
  else
    execute replace(def, o, nw);
  end if;
end $do$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

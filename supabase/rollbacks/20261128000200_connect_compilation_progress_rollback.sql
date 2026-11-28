-- COMPILATION PROGRESS FOR THE PERSON'S AI: the exact undo of migrations/20261128000200_connect_compilation_progress.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts public.connect_compilation_get(text, uuid) back EXACTLY as 20261127000400_connect_compilation_status.sql made it (git blob 806c847f; the body below is that file's function copied byte for byte, only `create function` is `create or replace function`),
-- with the same grants (the connector login only). The run then carries no step_done, step_total or percent. The connector (connect-core) treats absent keys as null and says nothing extra, so it can stay deployed.
-- Nothing else is touched: connect_compilations_open, connect_set_compilation_request, the request table, BUILDER's run table and its columns (BUILDER's own rollback removes those).

begin;

create or replace function public.connect_compilation_get(p_token_hash text, p_project uuid) returns jsonb
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

commit;

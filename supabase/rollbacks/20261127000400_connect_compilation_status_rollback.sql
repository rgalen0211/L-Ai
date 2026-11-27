-- THE COMPILATIONS DEPARTMENT FOR THE PERSON'S AI: the exact undo of migrations/20261127000400_connect_compilation_status.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- (It has no gate_apply line: the functions are the connector login's only, so the gate has nothing to change on the way out.)
-- It puts connect_set_compilation_request back EXACTLY as 20261026000300_compilation_requests.sql made it (no gate check), then removes connect_compilation_get and the gate helper. The request table, BUILDER's run table
-- and the site's own my_compilation_get are untouched. The connector's get_compilation_status then says that status is not available just now.

begin;

create or replace function public.connect_set_compilation_request(p_token_hash text, p_project uuid, p_request jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); sha text;
begin
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    return null;                                                    -- not the person's project: the tool answers "not found", and nothing is written
  end if;
  if jsonb_typeof(p_request) <> 'object' or p_request ->> 'schema' is distinct from 'ryagram.compilation-request/0' or octet_length(p_request::text) > 32768 then
    raise exception 'That request is not valid.' using errcode = '22023';
  end if;
  sha := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
  insert into public.compilation_requests (project_id, owner_id, request, request_sha256) values (p_project, me, p_request, sha)
  on conflict (project_id) do update set request = excluded.request, request_sha256 = excluded.request_sha256, updated_at = now()
  where public.compilation_requests.owner_id = me;
  return sha;
end $$;

revoke all on function public.connect_set_compilation_request(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.connect_set_compilation_request(text, uuid, jsonb) to connect_runner;

drop function if exists public.connect_compilation_get(text, uuid);
drop function if exists ryagram_private.connect_compilations_open(uuid);
commit;

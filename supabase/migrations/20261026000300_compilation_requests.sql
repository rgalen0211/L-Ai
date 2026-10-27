-- COMPILATION REQUESTS (NEXT-CONNECT 131a; Ryan's go in CC1's window 2026-10-26 ~18:09, part 2). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- It gives the connector's tool set_compilation_request (supabase/functions/connect-core/tools.ts, on main since Q203) the place it writes to: ONE request per project, DATA ONLY
-- (a phrase, folder NAMES, switches, picture/text rules; never a video, a sound, a path or anything about the account). The request starts nothing on the site and touches no credits.
-- Same shape as every other connect_* function: the token hash is the only identity (ryagram_private.connect_actor resolves the person and checks the grant and the 'write' scope in
-- the same transaction), no function takes an owner id, and EXECUTE is granted only to connect_runner. A project that is not the person's looks absent ('not found'), and nothing is written.
-- The person's OWN desktop app reads its request through the signed-in computer's node route (NEXT-CONNECT 131b); the table's one select policy lets a signed-in person read only their own row.
-- ORDER: independent of the trust-label migrations (20261026000100/200); applies after 20261018000100_connect_ai.sql. The connect function must be redeployed from a tree that has the tool for it to be callable (it already is on main). Undo: supabase/rollbacks/20261026000300_compilation_requests_rollback.sql.

begin;

create table public.compilation_requests (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  request jsonb not null check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 32768),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.compilation_requests enable row level security;
-- The person's own app may READ its request (signed in as the person). Nobody but the definer function below writes it; there is no insert, update or delete policy.
create policy compilation_requests_owner_read on public.compilation_requests for select to authenticated using (owner_id = auth.uid());
revoke all on public.compilation_requests from public, anon, authenticated, connect_runner;
grant select on public.compilation_requests to authenticated;

create function public.connect_set_compilation_request(p_token_hash text, p_project uuid, p_request jsonb) returns text
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

commit;

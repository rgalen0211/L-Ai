-- THE SIGNED READ LINK'S DATABASE QUESTION (CONNECT, 2026-11-05; plan proposals\CONNECT-MCP-APP-PLAN-1105.md section 5.3; function supabase/functions/editor-bundle). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- The editor-bundle Edge Function serves a film's drawing bundle to the AI chat's editor panel through a short-lived signed link. On EVERY read it asks ONE question, here:
--   may the owner whose hash the link names read the bundle of this project right now?
-- Yes only when ALL hold at this moment: the connector switch is on; the project exists; its owner hashes to the hash in the link; that owner may use AI connections (the same check as every connector call, connect_person_ok);
-- and the owner has a live (not revoked) grant that allows the edit scope. A deleted project, a revoked grant, a connection the person no longer has or the switch off all answer false at once. Any input that is not
-- a project and a hash answers false (never an error), so the function can say nothing about which part was wrong.
-- The owner hash is the first 32 hex characters of SHA-256('ryagram-editor-link:' || owner id): the link never carries the account id itself. editor-bundle/core.ts computes the same (pinned by a known answer in both tests).
-- editor_link_check: only the Edge Function's service role may call it; no API role, and not the connector's role. connect_editor_link_owner (below) is the connector's own, token first, like every connect_* function.
-- Undo: supabase/rollbacks/20261105000200_editor_link_check_rollback.sql.

begin;

create function ryagram_private.editor_link_owner_hash(p_owner uuid) returns text
language sql immutable set search_path = '' as $$
  select substr(encode(sha256(convert_to('ryagram-editor-link:' || p_owner::text, 'UTF8')), 'hex'), 1, 32)
$$;

create function public.editor_link_check(p_project uuid, p_owner_hash text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce(
    p_project is not null and p_owner_hash is not null and p_owner_hash ~ '^[0-9a-f]{32}$'
    and ryagram_private.connect_on()
    and exists (
      select 1 from public.projects p
       where p.id = p_project
         and ryagram_private.editor_link_owner_hash(p.owner_id) = p_owner_hash
         and ryagram_private.connect_person_ok(p.owner_id)
         and exists (select 1 from public.connect_grants g where g.owner_id = p.owner_id and g.revoked_at is null and 'edit' = any (g.scopes))),
    false);
end $$;

-- The connector's half: the connector never holds an account id, so it asks the database, with the token's hash, for the hash the link names the signed-in person by. Scope edit (the same as every editor call);
-- a project that is not the person's gives null, the same "not found" as everywhere in the connector.
create function public.connect_editor_link_owner(p_token_hash text, p_project uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
begin
  if p_project is null or not exists (select 1 from public.projects where id = p_project and owner_id = me) then return null; end if;
  return ryagram_private.editor_link_owner_hash(me);
end $$;

revoke execute on function ryagram_private.editor_link_owner_hash(uuid) from public, anon, authenticated, service_role;
revoke all on function public.connect_editor_link_owner(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.connect_editor_link_owner(text, uuid) to connect_runner;
revoke all on function public.editor_link_check(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.editor_link_check(uuid, text) to service_role;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

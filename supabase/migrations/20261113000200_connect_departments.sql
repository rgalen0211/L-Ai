-- THE PERSON'S DEPARTMENTS FOR THE AI'S HOME PANEL (CONNECT, 2026-11-13; CC1's item 4, "a Ryagram home panel in the chat to browse departments"). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. It ADDS one function and changes nothing.
-- The site's top bar asks public.my_departments() (a signed-in session) which departments exist and whether each WORKS for the account (20261027000100_departments.sql). The chat panel has no session: it is an iframe
-- in somebody else's page, and the connector calls the database with the TOKEN the person already gave their AI. So this is the token-checked twin: connect_my_departments(p_token_hash) resolves the person from the token on
-- every call (connect_actor, scope 'read') and answers EXACTLY what my_departments() answers for that person, in the same order: rows {id, label, status 'working' | 'soon'}, with a working department that needs
-- local-compute shown as 'soon' to an account without it (ryagram_private.departments_for, the one rule both use). It reads nothing else, writes nothing, takes no owner or department argument, and only the connector login can run it.
-- Nothing happens until the connector's switches (CONNECT_MCP_APP and CONNECT_HOME_PANEL) are on, and they are OFF.
-- Needs 20261027000100_departments.sql (departments_for) and 20261018000100_connect_ai.sql (connect_actor, connect_runner). Undo: supabase/rollbacks/20261113000200_connect_departments_rollback.sql. Check: supabase/live-steps/26_connect_departments_after_check.sql.

begin;

create function public.connect_my_departments(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'status', x.status) order by x.sort, x.id), '[]'::jsonb)
            from ryagram_private.departments_for(me) x);
end $$;

revoke execute on function public.connect_my_departments(text) from public, anon, authenticated;
grant execute on function public.connect_my_departments(text) to connect_runner;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (the function is the connector login's only, so the gate leaves it as it is)
commit;

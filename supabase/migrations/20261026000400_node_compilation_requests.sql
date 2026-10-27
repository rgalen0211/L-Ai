-- COMPILATION REQUESTS, THE APP'S SIDE (NEXT-CONNECT 131b; Ryan's go in CC1's window 2026-10-26 ~18:09, part 2). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- It needs 20261026000300_compilation_requests.sql (the table the person's AI writes into) and 20261021000100_r9_render_node.sql (the signed-in computer's token) applied first.
-- The person's own desktop app reads the requests their AI wrote, through the node function: the computer's token resolves the person (ryagram_private.node_actor, the same door as node_claim),
-- no argument names an owner, and only THAT person's rows come back. A request is DATA (a phrase, folder NAMES, switches, picture/text rules, a note): reading it starts nothing on the site,
-- creates no job, touches no credit, and holds no video, sound or path. The app shows it; the person decides.
-- At most 20 requests (the newest first), each with its project's title; nothing else about the account.
-- Undo: supabase/rollbacks/20261026000400_node_compilation_requests_rollback.sql.

begin;

create function public.node_compilation_requests(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('project_id', s.project_id, 'title', s.title, 'request', s.request, 'sha256', s.request_sha256, 'updated_at', s.updated_at) order by s.updated_at desc)
                     from (select r.project_id, p.title, r.request, r.request_sha256, r.updated_at
                             from public.compilation_requests r join public.projects p on p.id = r.project_id
                            where r.owner_id = me and p.owner_id = me
                            order by r.updated_at desc limit 20) s), '[]'::jsonb);
end $$;

revoke all on function public.node_compilation_requests(text) from public, anon, authenticated;
grant execute on function public.node_compilation_requests(text) to node_runner;

commit;

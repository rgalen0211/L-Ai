-- ADMIN: EACH TESTER'S COMPUTERS (NEXT-WEB 187). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes. After 20261021000100_r9_render_node.sql (which made the tester flag, node_tokens
-- and jobs.run_on / jobs.node_token_id). One read-only function for the admin page #/admin/tester: every account with the tester flag on, with each computer signed in to it (name, when it signed in, when the
-- sign-in ends, when it was last used) and two counts: this tester's films waiting for a computer, and the films this computer holds right now. Nothing here changes a table. What the database does NOT know, and
-- the function does not pretend to: whether the computer can render, and whether the app paused itself under its disk floor (the app does not report either; it only uses its sign-in, which sets last_used_at).
-- Admin only. Undo: supabase/rollbacks/20261031000100_admin_tester_devices_rollback.sql. After-check: supabase/live-steps/17_admin_tester_devices_after_check.sql.

begin;

create function public.admin_tester_devices() returns table (user_email text, computer_name text, created_at timestamptz, expires_at timestamptz,
                                                             last_used_at timestamptz, waiting_films int, running_films int)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query
  select u.email::text, t.computer_name, t.created_at, t.expires_at, t.last_used_at,
         (select count(*)::int from public.jobs j where j.owner_id = s.owner_id and j.run_on = 'owner_local' and j.state = 'queued'),
         case when t.id is null then 0 else (select count(*)::int from public.jobs j where j.node_token_id = t.id and j.state in ('claimed', 'running', 'validating', 'uploading')) end
  from public.account_settings s
  join auth.users u on u.id = s.owner_id
  left join public.node_tokens t on t.user_id = s.owner_id and t.revoked_at is null and t.expires_at > now()
  where s.local_compute
  order by u.email, t.created_at desc nulls last;
end $$;

revoke execute on function public.admin_tester_devices() from public, anon, node_runner;
grant execute on function public.admin_tester_devices() to authenticated;

commit;

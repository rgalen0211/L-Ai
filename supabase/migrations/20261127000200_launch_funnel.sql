-- THE LAUNCH FUNNEL, BY DAY, FROM THE TABLES THAT ALREADY FILL (BUILDER 2026-11-27; Claude's wave-8 order for Ryan). NOT APPLIED: Ryan applies it (live step 80). Undo: supabase/rollbacks/20261127000200_launch_funnel_rollback.sql.
-- The existing #/admin/funnel counts public.funnel_events, which fill only when the funnelTracking switch is on (it is off). This adds ONE read-only admin function that counts what the site already records, so the page works today:
--   signups_asked   different addresses that asked for a sign-up link that day (public.join_attempts; the Privacy page keeps these only 2 days, so the function returns NULL for every day before yesterday: 'not kept', never a 0)
--   accounts_opened accounts whose email was verified that day (auth.users.email_confirmed_at)
--   first_sheet     accounts whose FIRST contact sheet was asked for that day (public.jobs, job_type contact_sheet)
--   first_preview   accounts whose FIRST preview was asked for that day (job_type preview)
--   film_asked      accounts whose FIRST full film was asked for that day (job_type final_render, whatever happened next)
--   film_approved   accounts whose FIRST full film was let into the line that day: Ryan approved the request (render_stages.admin_decided_at, not declined), or it went straight in (no request: auto_render)
--   film_delivered  accounts whose FIRST full film finished that day (state complete, ended_at)
-- Each column after the first counts an ACCOUNT once, on the day it first reached that step. Days are Eastern (EST5EDT, the same day the existing funnel uses). Administrator and worker accounts are left out of every column.
-- NO new tracking, no new table, no cookie, no address or account id leaves the database: the function returns numbers per day only. Admin in the app only (require_admin: not through a connected AI, not the service key, not anonymous).
-- Apply AFTER: 20261017000600_pipe1_orders.sql (render_stages, require_admin), 20261104000200_waiting_join.sql (join_attempts), 20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
begin;

create function public.admin_launch_funnel(p_days int default 14)
returns table (day date, signups_asked int, accounts_opened int, first_sheet int, first_preview int, film_asked int, film_approved int, film_delivered int)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();           -- an admin acts from the app, never through a connected AI
        n int := least(greatest(coalesce(p_days, 14), 1), 60);
        today date := (now() at time zone 'EST5EDT')::date;
begin
  return query
  with days as (select (today - g)::date as d from generate_series(0, n - 1) g),
  people as (                                                  -- everyone but administrators and workers
    select u.id, u.email_confirmed_at from auth.users u
     where not exists (select 1 from public.app_admins a where a.user_id = u.id)
       and not exists (select 1 from public.workers w where w.user_id = u.id)),
  firsts as (
    select p.id,
           p.email_confirmed_at as opened,
           (select min(j.created_at) from public.jobs j where j.owner_id = p.id and j.job_type = 'contact_sheet') as sheet,
           (select min(j.created_at) from public.jobs j where j.owner_id = p.id and j.job_type = 'preview') as preview,
           (select min(j.created_at) from public.jobs j where j.owner_id = p.id and j.job_type = 'final_render') as asked,
           (select min(case when j.stage_id is null then j.created_at else s.admin_decided_at end)
              from public.jobs j left join public.render_stages s on s.id = j.stage_id
             where j.owner_id = p.id and j.job_type = 'final_render'
               and (j.stage_id is null or (s.admin_decided_at is not null and s.state <> 'declined'))) as approved,
           (select min(j.ended_at) from public.jobs j where j.owner_id = p.id and j.job_type = 'final_render' and j.state = 'complete') as delivered
      from people p),
  asks as (
    select (a.at at time zone 'EST5EDT')::date as d, count(distinct a.email_hash)::int as c
      from public.join_attempts a group by 1)
  select ds.d,
         case when ds.d >= today - 1 then coalesce((select k.c from asks k where k.d = ds.d), 0) end,      -- kept 2 days only (Privacy): older days are NULL, not 0
         (select count(*)::int from firsts f where (f.opened at time zone 'EST5EDT')::date = ds.d),
         (select count(*)::int from firsts f where (f.sheet at time zone 'EST5EDT')::date = ds.d),
         (select count(*)::int from firsts f where (f.preview at time zone 'EST5EDT')::date = ds.d),
         (select count(*)::int from firsts f where (f.asked at time zone 'EST5EDT')::date = ds.d),
         (select count(*)::int from firsts f where (f.approved at time zone 'EST5EDT')::date = ds.d),
         (select count(*)::int from firsts f where (f.delivered at time zone 'EST5EDT')::date = ds.d)
    from days ds
   order by ds.d desc;
end $$;

revoke execute on function public.admin_launch_funnel(int) from public, anon, service_role;
grant execute on function public.admin_launch_funnel(int) to authenticated;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

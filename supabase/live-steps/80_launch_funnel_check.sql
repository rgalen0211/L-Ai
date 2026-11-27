-- THE LAUNCH FUNNEL BY DAY (BUILDER branch builder-launch-funnel-1127; Claude's wave-8 order 11-27 03:22). Ryan's yes. Not urgent: nothing breaks without it.
-- WHAT IT GIVES: #/admin/funnel shows, day by day, how many people reached each step (sign-up asked, account opened, first contact sheet, first preview, first full film asked,
--   approved, delivered), counted from what the site already records. No new tracking, no cookie. The page needs this function AND the launchFunnel switch on for your account.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (rows 2 to 4 false), as expected. (2) ONCE: paste ALL of supabase/migrations/20261127000200_launch_funnel.sql into the SQL Editor
--   and Run. (3) THIS file again: the FIRST row must say PASS. STOP after the change: paste the undo below and tell CC1.
-- UNDO (only if CC1 asks): paste supabase/rollbacks/20261127000200_launch_funnel_rollback.sql. It removes the one function. Nothing else changes either way.
-- NOTE: the sign-up asks are kept only 2 days (the Privacy page), so that column is empty before yesterday. The function counts your own test accounts too (only administrators
--   and workers are left out).
with c as (
select 2 as n, 'the funnel function exists, a signed-in person can reach it, anonymous and the service key cannot' as check_name,
       coalesce(to_regprocedure('public.admin_launch_funnel(integer)') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.admin_launch_funnel(integer)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_launch_funnel(integer)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.admin_launch_funnel(integer)'), 'execute'), false) as ok
union all select 3, 'it lets only an admin in the app through (require_admin) and the waiting gate guards it (require_active)',
       coalesce((select p.prosrc like '%ryagram_private.require_admin()%' and p.prosrc like '%perform ryagram_private.require_active()%'
                   from pg_proc p where p.oid = to_regprocedure('public.admin_launch_funnel(integer)')), false)
union all select 4, 'it only reads (stable), returns numbers per day, keeps the sign-up asks to the 2 days Privacy allows, and leaves administrators and workers out',
       coalesce((select p.provolatile = 's' from pg_proc p where p.oid = to_regprocedure('public.admin_launch_funnel(integer)'))
         and pg_get_function_result(to_regprocedure('public.admin_launch_funnel(integer)')) = 'TABLE(day date, signups_asked integer, accounts_opened integer, first_sheet integer, first_preview integer, film_asked integer, film_approved integer, film_delivered integer)'
         and pg_get_functiondef(to_regprocedure('public.admin_launch_funnel(integer)')) like '%case when ds.d >= today - 1 then%'
         and pg_get_functiondef(to_regprocedure('public.admin_launch_funnel(integer)')) like '%public.app_admins a where a.user_id = u.id%'
         and pg_get_functiondef(to_regprocedure('public.admin_launch_funnel(integer)')) like '%public.workers w where w.user_id = u.id%', false)
union all select 5, 'the tables it reads are still there (jobs, render_stages, join_attempts)',
       to_regclass('public.jobs') is not null and to_regclass('public.render_stages') is not null and to_regclass('public.join_attempts') is not null
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: the launch funnel can be read' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

-- THE TOP BAR PER ACCOUNT (BUILDER branch builder-dept-switches-1127; CC1's 08:10 one-switch design). Ryan's yes. Turning a department on for an account is a separate step.
-- WHAT IT GIVES: a department (compilations, games, Perfect City) shows as working in the top bar and in the chat panel for an account whose switch is on in the per-account switch list,
--   and exactly as before for everyone else. No table, column or grant changes.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (rows 2 and 3 false), as expected. (2) ONCE: paste ALL of supabase/migrations/20261127000250_department_switches.sql into the SQL Editor and
--   Run. If it says 'is not the one this change expects', STOP: nothing was changed (one transaction), tell CC1 and BUILDER. (3) THIS file again: the FIRST row must say PASS.
-- THEN, PER DEPARTMENT, OWNER FIRST: switch it on for your own TEST account (an administrator account sees no departments at all) with admin_account_switch_set in the app, walk it, and
--   later open it for everyone with 82a (compilations), 82b (games) or 82c (Perfect City). Each undo: 82d, 82e, 82f.
-- NOTE (CC1 08:46): until 20261127000300 (compilations for everyone) is applied, the compilations switch shows the department but signing in a computer still needs the tester flag;
--   82a refuses until then.
-- UNDO OF THE WHOLE CHANGE (only if CC1 asks): paste supabase/rollbacks/20261127000250_department_switches_rollback.sql.
with c as (
select 2 as n, 'the switch map exists (compilations, games, perfectCity), runs as its owner with a fixed search path, and no API role can call it' as check_name,
       coalesce(to_regprocedure('ryagram_private.department_switch_on(uuid,text)') is not null
         and pg_get_functiondef(to_regprocedure('ryagram_private.department_switch_on(uuid,text)')) like '%when ''compilations'' then ''compilations'' when ''games'' then ''games'' when ''geo_intelligence'' then ''perfectCity''%'
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.department_switch_on(uuid,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.department_switch_on(uuid,text)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('ryagram_private.department_switch_on(uuid,text)'), 'execute')
         and (select p.prosecdef and coalesce(array_to_string(p.proconfig, ' '), '') like '%search_path=%'
                     and not coalesce(array_to_string(p.proacl::text[], ' ') ~ '(^| )=X', true)
                from pg_proc p where p.oid = to_regprocedure('ryagram_private.department_switch_on(uuid,text)')), false) as ok
union all select 3, 'the top bar and the chat panel read it: working for an account whose switch is on, as before for everyone else',
       coalesce(replace(pg_get_functiondef('ryagram_private.departments_for(uuid)'::regprocedure), chr(13), '')
                like '%case when ryagram_private.department_switch_on(p_owner, d.id) then ''working'' when d.status = ''working'' and d.needs_local_compute%', false)
union all select 4, 'the departments are there: ' || coalesce((select string_agg(d.id || ' ' || d.status, ', ' order by d.sort) from public.departments d), 'none'), true
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: departments can be switched on per account' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

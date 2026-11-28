-- COMPILATION PROGRESS, COUNTS ONLY (BUILDER branch builder-compilation-progress-1127; Ryan's 23:06 mid-test finding). Ryan's yes. Post-launch.
-- WHAT IT GIVES: while the Ryagram app plans or builds a compilation, the site and the AI can say "video 2 of 3, about 45% overall" or "clip 3 of 4". The server is told three whole numbers only:
--   never a file name, a folder, a path or a word. The numbers are kept only while the build runs.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (rows 2 to 6 false), as expected. Live step 81 must already say PASS. (2) ONCE: paste ALL of
--   supabase/migrations/20261128000100_compilation_progress.sql into the SQL Editor and Run (one transaction). (3) THIS file again: the FIRST row must say PASS, and step 81 (this branch's copy) still PASS.
--   (4) redeploy the node function from builder-compilation-progress-1127: until then the computer reports as today, with no progress (the 8-argument report keeps working).
-- UNDO (only if CC1 asks): redeploy node from 7974d08c first, undo CONNECT's progress read if it was applied, then paste supabase/rollbacks/20261128000100_compilation_progress_rollback.sql.
with c as (
select 2 as n, 'the run reports gain exactly three whole-number columns: step_done, step_total, percent (and still no path, transcript or video column)' as check_name,
       coalesce((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs'
                  and column_name in ('step_done', 'step_total', 'percent') and data_type = 'integer') = 3
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs') = 15
         and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs' and column_name ~ '(path|url|text|transcript|video|file|name)'), false) as ok
union all select 3, 'the numbers have their ranges and are kept only while a build runs (table checks)',
       coalesce((select count(*) from pg_constraint where conrelid = to_regclass('public.compilation_runs')
                  and conname in ('compilation_runs_step_total_range', 'compilation_runs_step_done_range', 'compilation_runs_percent_range', 'compilation_runs_progress_only_running')) = 4, false)
union all select 4, 'the computer''s report takes the three numbers, and only the node role (the computer''s own token) can call it',
       coalesce(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)') is not null
         and has_function_privilege('node_runner', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)'), 'execute')
         and pg_get_functiondef(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text,integer,integer,integer)')) like '%Progress is only sent while a build is running.%', false)
union all select 5, 'the report the node function deployed tonight sends (8 arguments) still works: it is the same call with no progress, for the node role only',
       coalesce(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)') is not null
         and pg_get_functiondef(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)')) like '%p_error_code, null::int, null::int, null::int)%'
         and has_function_privilege('node_runner', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute'), false)
union all select 6, 'the page''s read gives the three numbers, clears them when it closes a silent build, and the waiting gate still guards it',
       coalesce((select p.prosrc like '%''step_done'', c.step_done, ''step_total'', c.step_total, ''percent'', c.percent%'
                    and p.prosrc like '%step_done = null, step_total = null, percent = null%'
                    and p.prosrc like '%perform ryagram_private.require_active()%' and p.prosrc like '%require_app_session()%'
                  from pg_proc p where p.oid = to_regprocedure('public.my_compilation_get(uuid)')), false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: the computer can report counts-only progress' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

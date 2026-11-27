-- COMPILATIONS FOR EVERY USER, THE SERVER HALF (BUILDER branch builder-compilations-server-1127; Claude's 08:10 departments order). Ryan's yes. Turning it on for an account is a separate step.
-- WHAT IT GIVES: an account with the compilations switch can save a "find every time X says Y" request from the site, sign in its own computer, and see its computer's progress (counts only).
--   The film is made on the person's own computer and stays there: the site never receives a video, a sound, a path or a transcript, and no credits are used.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (rows 2 to 10 false), as expected. (2) ONCE: paste ALL of supabase/migrations/20261127000300_compilations_for_everyone.sql into the SQL Editor
--   and Run. If it says 'is not the one this change expects', STOP: nothing was changed (one transaction); send the sentence to CC1 and BUILDER. (3) THIS file again: the FIRST row must say PASS.
--   (4) redeploy the node function from the merged head: until then the computer cannot report progress (its requests still load). PASS here proves the database half only.
--   A computer signed in for compilations claims no job; like a tester's it can read and write that person's OWN editor summaries, download and footage plans.
-- TURNING IT ON, after PASS: for a TEST account first (an administrator account sees no departments and is off here too), in the app as admin: admin_account_switch_set('<the test account address>', 'compilations', true, 'trying compilations'),
--   and the page half's switch rides its own page push. For everyone later: live step 82a (opens the compilations department for everyone), undo 82d. Needs 82 (20261127000250) first.
-- UNDO OF THE WHOLE CHANGE (only if CC1 asks): paste supabase/rollbacks/20261127000300_compilations_for_everyone_rollback.sql. Its header says how to sign out computers that only compilations signed in.
with c as (
select 2 as n, 'compilations follows the top bar (departments_for: the switch or step 82a, invited accounts only), never a worker, never a waiting account' as check_name,
       coalesce(to_regprocedure('ryagram_private.department_switch_on(uuid,text)') is not null
         and pg_get_functiondef(to_regprocedure('ryagram_private.compilations_on(uuid)')) like '%ryagram_private.departments_for(p_person)%'
         and to_regprocedure('ryagram_private.compilations_on(uuid)') is not null
         and pg_get_functiondef(to_regprocedure('ryagram_private.compilations_on(uuid)')) like '%public.workers w where w.user_id = p_person%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.compilations_on(uuid)')) like '%ryagram_private.account_active(p_person)%'
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.compilations_on(uuid)'), 'execute'), false) as ok
union all select 3, 'the site''s two calls exist, only a signed-in person in the app reaches them, the waiting gate guards them, and a request may hold no file, path or link',
       coalesce(to_regprocedure('public.my_compilation_set(uuid,jsonb)') is not null and to_regprocedure('public.my_compilation_get(uuid)') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.my_compilation_set(uuid,jsonb)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.my_compilation_set(uuid,jsonb)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.my_compilation_set(uuid,jsonb)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.my_compilation_get(uuid)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.my_compilation_get(uuid)'), 'execute')
         and (select p.prosrc like '%require_app_session()%' and p.prosrc like '%perform ryagram_private.require_active()%' and p.prosrc like '%compilation_request_problem(p_request)%'
                from pg_proc p where p.oid = to_regprocedure('public.my_compilation_set(uuid,jsonb)'))
         and (select p.prosrc like '%require_app_session()%' and p.prosrc like '%perform ryagram_private.require_active()%'
                from pg_proc p where p.oid = to_regprocedure('public.my_compilation_get(uuid)')), false)
union all select 4, 'the computer''s report exists and only the node role (the computer''s own token) can call it',
       coalesce(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)') is not null
         and has_function_privilege('node_runner', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'), 'execute'), false)
union all select 5, 'the run reports hold counts only (no path, transcript or video column), a person reads only their own, nobody writes them but the report',
       coalesce(to_regclass('public.compilation_runs') is not null
         and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs') = 12
         and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs' and column_name ~ '(path|url|text|transcript|video|file)')
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'compilation_runs' and policyname = 'compilation_runs_owner_read')
         and not has_table_privilege('authenticated', 'public.compilation_runs', 'insert') and not has_table_privilege('anon', 'public.compilation_runs', 'select'), false)
union all select 6, 'a computer may be signed in by a tester OR an account with compilations on (and by nobody else)',
       coalesce(replace(pg_get_functiondef('public.device_decide(text, boolean)'::regprocedure), chr(13), '')
                like '%if p_approve and not (coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or ryagram_private.compilations_on(me)) then%', false)
union all select 7, 'a request keeps the connector''s own rules: only its known parts, a phrase, 1 to 10 folder names, and songs are not open (read from the checker''s text)',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.compilation_request_problem(jsonb)')) like '%That compilation request has a part Ryagram does not know%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.compilation_request_problem(jsonb)')) like '%Songs are not open in compilations yet%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.compilation_request_problem(jsonb)')) like '%Name 1 to 10 folders.%', false)
union all select 8, 'a failed build gives one reason from the closed list of eleven, and only Ryagram itself sets stale',
       coalesce(pg_get_functiondef(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)'))
                like '%codes constant text[] := array[''request_invalid'', ''song_request'', ''folder_not_chosen'', ''folder_missing'', ''folder_empty'', ''folders_overlap'', ''no_speech'', ''not_said'', ''edit_failed'', ''build_failed'', ''crash'']%'
         and pg_get_functiondef(to_regprocedure('public.node_compilation_report(text,uuid,text,text,integer,integer,numeric,text)')) like '%p_error_code = ''stale'' then%', false)
union all select 9, 'the desktop app can be given to an account with compilations on (as to a tester or an administrator)',
       coalesce(to_regprocedure('public.request_app_download(uuid,text)') is not null
         and replace(pg_get_functiondef(to_regprocedure('public.request_app_download(uuid,text)')), chr(13), '') like '%or ryagram_private.compilations_on(p_owner)) then%', false)
union all select 10, 'the AI is told a compilations account may have the desktop app (connect_whoami, as for a tester or an administrator, and it passes when the AI is not told about the app at all, 20261123000500 not applied)',
       coalesce(to_regprocedure('public.connect_whoami(text)') is not null
         and (pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) not like '%desktop_app%'
              or replace(pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')), chr(13), '') like '%or ryagram_private.compilations_on(me))%'), false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: compilations can be switched on per account' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

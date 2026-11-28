-- THE DESKTOP APP AS A SETUP EXE (BUILDER branch builder-app-setup-exe-1128; Claude 23:30 installer order, Ryan's 23:49 direct-download yes). Ryan's yes.
-- WHAT IT GIVES: the app's release record may name Ryagram-Setup-<version>.exe (today only a .zip). Who may download, the 15-minute link and the 3 a day are unchanged.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (row 2 false), as expected. (2) ONCE: paste ALL of supabase/migrations/20261128000300_app_setup_exe.sql and Run (one transaction).
--   If it says 'is not the one this change expects', STOP: nothing was changed; send the sentence to CC1 and BUILDER. (3) THIS file again: the FIRST row must say PASS.
--   Then CONNECT's release sheet (upload the exe, add its row, switch the active app row).
-- UNDO (only if CC1 asks): switch the app row back to the zip, then paste supabase/rollbacks/20261128000300_app_setup_exe_rollback.sql (past exe rows stay as history).
with c as (
select 2 as n, 'a release of kind app may be a setup exe (and an add-on or the notices may not)' as check_name,
       coalesce((select count(*) from pg_constraint k where k.conrelid = to_regclass('public.app_releases') and k.contype = 'c'
                  and pg_get_constraintdef(k.oid) like '%file_name%' and pg_get_constraintdef(k.oid) like '%exe%' and pg_get_constraintdef(k.oid) like '%kind = ''app''%') = 1, false) as ok
union all select 3, 'a zip and the notices text are still allowed, and only one file name check exists',
       coalesce((select count(*) from pg_constraint k where k.conrelid = to_regclass('public.app_releases') and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%file_name%') = 1
         and (select bool_and(pg_get_constraintdef(k.oid) like '%(zip|txt)$%') from pg_constraint k where k.conrelid = to_regclass('public.app_releases') and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%file_name%'), false)
union all select 4, 'who may download is unchanged: a tester, an administrator, or an account with compilations on (only the service role calls it)',
       coalesce(replace(pg_get_functiondef(to_regprocedure('public.request_app_download(uuid,text)')), chr(13), '') like '%or ryagram_private.compilations_on(p_owner)) then%'
         and not has_function_privilege('authenticated', to_regprocedure('public.request_app_download(uuid,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.request_app_download(uuid,text)'), 'execute'), false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: the app can be released as a setup exe' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

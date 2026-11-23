-- AFTER 20261123000400_retention_join_attempts.sql (A17; GEO 2026-11-23, GAMES 11:04): the daily retention purge also removes old sign-up and invite-code tries.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration (or after its rollback) rows 1 and 2 answer false and row 3 is still true, never an error. If a row is false after A17: STOP, tell CC1.
-- What it promises: join_attempts (the scrambled address and email of a sign-up try) go after 2 days, as the Privacy page says, and invite_attempts
-- (failed invite-code guesses) after 1 day. The purge runs once a New York day, so a row can live up to about a day longer than that.
select 'retention_purge removes sign-up tries (join_attempts) older than 2 days' as check_name,
       coalesce((select p.prosrc like '%delete from public.join_attempts where at < now() - interval ''2 days''%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 'retention_purge removes failed invite-code guesses (invite_attempts) older than 1 day' as check_name,
       coalesce((select p.prosrc like '%delete from public.invite_attempts where at < now() - interval ''1 day''%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 'retention_purge is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')
                  from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok;

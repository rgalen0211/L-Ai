-- AFTER 20261121000500_unfinished_uploads_purged.sql (GEO 2026-11-21; CC1 12:36 G1): uploads_due_for_deletion also lists an upload never finished, a day after its slot was made.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 'uploads_due_for_deletion lists an upload never finished a day after its slot was made' as check_name,
       coalesce((select p.prosrc like '%d.uploaded_at is null and d.created_at < now() - interval ''1 day''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 'uploads_due_for_deletion keeps its old rules (Delete, Recently deleted, Don''t keep, rejected)' as check_name,
       coalesce((select p.prosrc like '%d.delete_requested_at is not null%' and p.prosrc like '%d.trashed_at < now() - interval ''7 days''%' and p.prosrc like '%d.retention = ''dont_keep''%' and p.prosrc like '%d.status = ''rejected''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 'uploads_due_for_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok;

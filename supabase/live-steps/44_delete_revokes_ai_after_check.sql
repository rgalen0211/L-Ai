-- AFTER 20261121000550_delete_revokes_ai.sql (GEO 2026-11-21; CC1 12:36 G1): account_request_deletion also revokes the person's AI connection grants and tokens.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 'account_request_deletion revokes the person''s AI connection grants and tokens' as check_name,
       coalesce((select p.prosrc like '%update public.connect_grants set revoked_at = now() where owner_id = p_owner%' and p.prosrc like '%update public.connect_tokens set revoked_at = now() where owner_id = p_owner%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 'account_request_deletion still records the request once' as check_name,
       coalesce((select p.prosrc like '%insert into public.account_deletion_requests%' and p.prosrc like '%on conflict (owner_id) do nothing%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 'account_request_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok;

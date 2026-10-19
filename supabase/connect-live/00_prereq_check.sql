-- READ-ONLY. Run in the SQL Editor of the LIVE project BEFORE anything else. It changes nothing.
-- Every row must say present = true except the two marked "must be false" and the optional ones. If a required row is false, STOP: the connect
-- migration needs something the live project does not have yet, and the earlier migrations in supabase/README.md must be applied first.
select 'function public.submit_job(uuid, job_type, jsonb, uuid, uuid)' as item, 'required' as needed_by,
       to_regprocedure('public.submit_job(uuid, public.job_type, jsonb, uuid, uuid)') is not null as present
union all select 'function public.create_version(uuid, uuid)', 'required', to_regprocedure('public.create_version(uuid, uuid)') is not null
union all select 'function public.queue_position(uuid)', 'required', to_regprocedure('public.queue_position(uuid)') is not null
union all select 'function ryagram_private.require_signed_in()', 'required', to_regprocedure('ryagram_private.require_signed_in()') is not null
union all select 'function ryagram_private.is_app_admin()', 'required', to_regprocedure('ryagram_private.is_app_admin()') is not null
union all select 'table public.projects', 'required', to_regclass('public.projects') is not null
union all select 'table public.versions', 'required', to_regclass('public.versions') is not null
union all select 'table public.jobs', 'required', to_regclass('public.jobs') is not null
union all select 'table public.app_admins', 'required', to_regclass('public.app_admins') is not null
union all select 'table public.workers', 'required', to_regclass('public.workers') is not null
union all select 'publication supabase_realtime', 'required', exists (select 1 from pg_publication where pubname = 'supabase_realtime')
union all select 'function public.current_engine_commit()', 'optional (the engine version for the ladder)', to_regprocedure('public.current_engine_commit()') is not null
union all select 'function public.credit_quote(uuid, job_type)', 'optional (credits ledger 2B; without it a connection sees 0 credits and nothing is charged)', to_regprocedure('public.credit_quote(uuid, public.job_type)') is not null
union all select 'connect tables already there (must be false on a first run)', 'must be false', to_regclass('public.connect_tokens') is not null
union all select 'role connect_runner already there (must be false on a first run)', 'must be false', exists (select 1 from pg_roles where rolname = 'connect_runner')
order by needed_by, item;

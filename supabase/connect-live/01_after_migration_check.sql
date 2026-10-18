-- READ-ONLY. Run AFTER supabase/migrations/20261018000100_connect_ai.sql. Every row's "ok" must be true.
select 'the ten connect tables exist' as check_name,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('connect_access', 'connect_clients', 'connect_redirect_allowlist', 'connect_requests',
               'connect_codes', 'connect_tokens', 'connect_grants', 'connect_calls', 'connect_buckets', 'connect_flags')) = 10 as ok
union all select 'row security is on for every connect table',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'connect\_%' and c.relkind = 'r' and not c.relrowsecurity) = 0
union all select 'anon and signed-in people have no privilege on any connect table',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname like 'connect\_%' and c.relkind = 'r'
           and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) = 0
union all select 'connect_runner exists, is not a superuser and has no table privilege anywhere in public',
       exists (select 1 from pg_roles where rolname = 'connect_runner' and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls)
       and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
               and has_table_privilege('connect_runner', c.oid, 'select,insert,update,delete,truncate,references,trigger')) = 0
-- Counts only what the role can really CALL: a function in a schema it has no USAGE on cannot be reached, and a trigger or event-trigger function can only
-- be run by the database as a trigger (Supabase's own public.rls_auto_enable is one, executable by everyone), never called by a person or a login.
union all select 'connect_runner can call exactly 22 functions, all connect_*, and only in the public schema',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE') and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
           and n.nspname not in ('pg_catalog', 'information_schema')) = 22
       and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE') and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
               and n.nspname not in ('pg_catalog', 'information_schema') and not (n.nspname = 'public' and p.proname like 'connect\_%')) = 0
union all select 'signed-in people cannot call the tool or authorization-server functions',
       not has_function_privilege('authenticated', 'public.connect_whoami(text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.connect_exchange_code(text, text, text, text, text, text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.connect_register_client(text, text[])', 'EXECUTE')
union all select 'every published realtime table has the restrictive client_id policy',
       (select count(*) from ryagram_private.connect_unguarded_published_tables()) = 0
union all select 'every connect_no_oauth_select policy is RESTRICTIVE (none is permissive) and at least one exists',
       not exists (select 1 from pg_policy where polname = 'connect_no_oauth_select' and polpermissive)
       and exists (select 1 from pg_policy where polname = 'connect_no_oauth_select' and not polpermissive)
union all select 'realtime.messages has NO policy (a private channel needs one to be allowed; this app uses only public table-change channels)',
       not exists (select 1 from pg_policy where polrelid = to_regclass('realtime.messages'))
union all select 'the master switch row exists and is currently ON (turn it off with 90_switch_off.sql)',
       (select connections_enabled from public.connect_flags where id)
union all select 'full renders from a connection are off',
       not (select full_render_enabled from public.connect_flags where id)
union all select 'the redirect allowlist has NO loopback row enabled (live must keep loopback off)',
       not exists (select 1 from public.connect_redirect_allowlist where kind = 'loopback' and enabled)
union all select 'nobody is invited yet (a first run) - or only the people you meant',
       true
order by check_name;

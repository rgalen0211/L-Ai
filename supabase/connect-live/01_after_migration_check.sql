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
-- ACCEPTED RESIDUAL (Ryan, RYAN-QUEUE Q55, typed to Claude 2026-10-18 21:38): Supabase's schema net (pg_net) grants USAGE to PUBLIC, owned and granted by supabase_admin, so no project role can
-- revoke it. The role can therefore call pg_net's own functions (it can make the database send web requests; it still cannot read a table). Exactly the
-- named pg_net functions, owned by supabase_admin in schema net, are tolerated and counted in the row's NAME; any other extra function still makes the row false.
-- When Supabase support removes PUBLIC's usage on net, the count reads 0 and this tolerance can be deleted.
union all select 'connect_runner can call exactly the connect_* functions (22; 23 once 20261026000300_compilation_requests is applied; 26 once 20261027000400_live_editor is applied), all of them in the public schema'
       || (select case when count(*) = 0 then '' else ' (plus ' || count(*) || ' named pg_net functions in schema net: ACCEPTED RESIDUAL (Ryan, RYAN-QUEUE Q55, typed to Claude 2026-10-18 21:38))' end
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
              and (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')),
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE') and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and not (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')
           and n.nspname not in ('pg_catalog', 'information_schema'))
           = 22 + (case when to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)') is not null then 1 else 0 end)
           + (case when to_regprocedure('public.connect_edit_state(text, uuid)') is not null then 3 else 0 end)
           + (case when to_regprocedure('public.connect_request_download(text, text, text, text)') is not null then 2 else 0 end)
       and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE') and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and not (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')
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

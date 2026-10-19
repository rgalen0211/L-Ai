-- NON-LIVE project (and later live, read-only): everything the role connect_runner can do, in ONE result grid, from the real catalogs.
-- It looks at EVERY schema (no fixed list): any schema the role can enter, any function it can run, and any table, view or sequence it holds a privilege on, anywhere.
-- Expected: schema usage on public only; EXECUTE on the connect_* functions listed in CONNECT-DESIGN.md; the harmless built-in helpers
-- every role has (auth.uid / auth.jwt / storage.foldername...); and NO table, view or sequence rows at all.
select 'schema usage'::text as kind, n.nspname::text as name
  from pg_namespace n where has_schema_privilege('connect_runner', n.oid, 'USAGE') and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
union all
select case when p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
            then 'trigger function it may execute (cannot be called directly: listed so nothing is hidden)'
            when (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin') then 'ACCEPTED RESIDUAL (Ryan, RYAN-QUEUE Q55, typed to Claude 2026-10-18 21:38): pg_net function in schema net, PUBLIC usage, owned by supabase_admin'
            else 'function execute' end,
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%' and p.prokind in ('f', 'p')
    and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
    -- A function can only be CALLED with USAGE on its schema. Supabase makes many platform functions in auth, storage, realtime and
    -- graphql_public executable by everyone, but connect_runner has no usage on those schemas, so it cannot call them.
    and has_schema_privilege('connect_runner', n.oid, 'USAGE')
union all
select case when has_schema_privilege('connect_runner', n.oid, 'USAGE') then 'RELATION PRIVILEGE (must be none)'
             else 'relation privilege in a schema it cannot enter (platform default, unreachable)' end, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and has_table_privilege('connect_runner', c.oid, 'select,insert,update,delete,truncate,references,trigger')
union all
select case when has_schema_privilege('connect_runner', n.oid, 'USAGE') then 'SEQUENCE PRIVILEGE (must be none)'
             else 'sequence privilege in a schema it cannot enter (platform default, unreachable)' end, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%' and c.relkind = 'S'
    and case when c.relkind = 'S' then has_sequence_privilege('connect_runner', c.oid, 'usage,select,update') else false end
union all
select 'role flags', 'superuser=' || rolsuper || ' createdb=' || rolcreatedb || ' createrole=' || rolcreaterole || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin || ' inherit=' || rolinherit
  from pg_roles where rolname = 'connect_runner'
union all
select 'member of (must be none)', g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member where r.rolname = 'connect_runner'
order by 1, 2;

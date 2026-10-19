-- NON-LIVE project (and later live, read-only): everything the role connect_runner can do, in ONE result grid, from the real catalogs.
-- Expected: schema usage on public only; EXECUTE on the connect_* functions listed in CONNECT-DESIGN.md; the harmless built-in helpers
-- every role has (auth.uid / auth.jwt / storage.foldername...); and NO table, view or sequence rows at all.
select 'schema usage' as kind, n.nspname as name
  from pg_namespace n where has_schema_privilege('connect_runner', n.oid, 'USAGE') and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
union all
select 'function execute', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'ryagram_private', 'auth', 'storage', 'extensions', 'realtime', 'graphql_public', 'vault') and p.prokind in ('f', 'p')
    and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
    -- A function can only be CALLED with USAGE on its schema. Supabase makes many platform functions in auth, storage, realtime and
    -- graphql_public executable by everyone, but connect_runner has no usage on those schemas, so it cannot call them.
    and has_schema_privilege('connect_runner', n.oid, 'USAGE')
union all
select 'RELATION PRIVILEGE (must be none)', n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'ryagram_private', 'auth', 'storage', 'realtime', 'vault') and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and has_table_privilege('connect_runner', c.oid, 'select,insert,update,delete,truncate,references,trigger')
union all
select 'role flags', 'superuser=' || rolsuper || ' createdb=' || rolcreatedb || ' createrole=' || rolcreaterole || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin || ' inherit=' || rolinherit
  from pg_roles where rolname = 'connect_runner'
union all
select 'member of (must be none)', g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member where r.rolname = 'connect_runner'
order by 1, 2;

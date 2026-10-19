-- READ-ONLY. Q55b: who owns the schema net and its functions, what their grants are, and could the project's postgres role change them?
-- Run in the LIVE SQL Editor (it only reads). Every column is named. Paste the grid to CONNECT / CC1.
-- postgres_is_member_of_owner = false on every row means postgres can NOT revoke or regrant anything there (only the owner, or a member of the owner, can change
-- an owner's objects), which closes option (a) 'revoke EXECUTE on net.* from PUBLIC'. If the project has no schema net the grid is simply empty.
select 'schema' as kind, n.nspname::text as name, pg_get_userbyid(n.nspowner)::text as owner, coalesce(n.nspacl::text, '(no explicit ACL)') as acl,
       pg_has_role('postgres', n.nspowner, 'MEMBER') as postgres_is_member_of_owner
  from pg_namespace n where n.nspname = 'net'
union all
select 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner)::text, coalesce(p.proacl::text, '(default: the owner and PUBLIC may execute)'),
       pg_has_role('postgres', p.proowner, 'MEMBER')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net'
union all
select 'default privileges for new objects in net', 'granted by ' || pg_get_userbyid(d.defaclrole)::text, pg_get_userbyid(d.defaclrole)::text, coalesce(d.defaclacl::text, '(none)'),
       pg_has_role('postgres', d.defaclrole, 'MEMBER')
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'net'
order by 1 desc, 2;

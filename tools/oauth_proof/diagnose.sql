-- Throwaway project only. Read-only: shows whether the pre-request setting is stored and the function exists.
-- Run it and send me the three result grids as text (nothing in them is secret).
select rolname, rolconfig from pg_roles where rolname = 'authenticator';
select n.nspname as schema, p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'proof_pre_request';
select setting from pg_settings where name = 'server_version';

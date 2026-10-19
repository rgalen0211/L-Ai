-- LIVE ROLLBACK: REMOVE THE CONNECTOR FROM THE DATABASE COMPLETELY. DESTRUCTIVE: it deletes every connect table and its rows (clients, tokens,
-- permissions, the allowlist, the call log) and every connect function. It touches NOTHING of the app (projects, versions, jobs, accounts, credits).
-- Do 90_switch_off.sql and 98_end_all_connections.sql first, and delete the Edge function (see CONNECT-LIVE-PLAN.md). Not applied by anything automatically.
-- The Realtime policies it added to published tables are removed too. The role connect_runner is dropped (its password stops working).
begin;
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and (p.proname like 'connect\_%' or p.proname in ('my_connected_ais', 'disconnect_ai', 'admin_set_connect_access', 'admin_connect_allowlist_set',
                                                                                          'admin_connect_set_enabled', 'admin_connect_revoke_all')))
              or (n.nspname = 'ryagram_private' and p.proname like 'connect\_%') loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'connect\_%' loop
    execute 'drop table public.' || quote_ident(r.relname) || ' cascade';
  end loop;
  for r in select p.schemaname, p.tablename from pg_publication_tables p where p.pubname = 'supabase_realtime' loop
    execute format('drop policy if exists connect_no_oauth_select on %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'connect_runner') then
    revoke usage on schema public from connect_runner;
    begin
      drop role connect_runner;
    exception when dependent_objects_still_exist then
      raise notice 'connect_runner is still used by another database in this cluster; its login is switched off instead';
      alter role connect_runner nologin;
    end;
  end if;
end $$;
commit;

-- Check (every column aliased): nothing of the connector is left.
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'connect\_%') as connect_tables_left,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private') and p.proname like '%connect%') as connect_functions_left,
       exists (select 1 from pg_roles where rolname = 'connect_runner') as runner_role_left;

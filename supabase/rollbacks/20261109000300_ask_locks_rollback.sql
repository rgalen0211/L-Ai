-- ASK LOCKS: the exact undo of migrations/20261109000300_ask_locks.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It takes the lock statement back out of the three functions (from their own stored text); nothing else is touched, and no data is lost. After it, two asks in flight together can again pass the 5-open and 100-a-day limits.
begin;

do $$
declare
  f record; def text; n int;
  nl constant text := chr(10);
  anchor constant text := 'begin' || nl || '  delete from public.geo_requests where asked_at < now() - interval ''7 days'';' || nl;
  locked constant text := 'begin' || nl || '  perform pg_advisory_xact_lock(hashtextextended(''geo:'' || me::text, 0));' || nl || '  delete from public.geo_requests where asked_at < now() - interval ''7 days'';' || nl;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname in ('connect_geo_ask', 'connect_geo_ask_shape', 'connect_forecast_ask') order by p.proname
  loop
    def := pg_get_functiondef(f.oid);
    if position('pg_advisory_xact_lock' in def) = 0 then continue; end if;       -- not locked
    n := (length(def) - length(replace(def, locked, ''))) / length(locked);
    if n <> 1 then
      raise exception 'The function % is not as expected (the lock was found % times, not once); nothing was changed.', f.proname, n;
    end if;
    execute replace(def, locked, anchor);
  end loop;
end $$;

commit;

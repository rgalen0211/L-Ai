-- ASK LOCKS (CONNECT, 2026-11-09; WORKER's finding 19:36 and CC1's order 19:37, proved on two connections). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES LIVE FUNCTIONS.
-- The three live place-question ask functions (connect_geo_ask 20261104000300, connect_geo_ask_shape 20261104000400, connect_forecast_ask 20261104000500) all count a person's open and today's requests in public.geo_requests and
-- THEN insert, with nothing between. Two asks in flight together (an AI making parallel tool calls) each see 4 open, and each insert: 6 open (the limit is 5); the 100-a-day count has the same gap.
-- The fix: each function takes one advisory lock per person ("geo:" + the person's id) as its first statement. A second ask waits until the first has committed, then counts it. Another person's ask is never held. All
-- three share the one lock because they share the one table and the one pair of limits.
-- HOW: it re-creates the functions from their OWN stored text with one statement added right after `begin`, so nothing can drift from what is live (no copy of the bodies is made here). A function that is not on this
-- database is skipped; one that is already locked is left alone (so this is safe to run twice); one whose first lines are not exactly what main has stops the whole migration with a plain sentence and changes nothing.
-- Grants, owner and settings are kept (create or replace). Nothing else is touched. What a person sees when two asks race at the limit: the first is accepted, the second is refused in words
-- ("There are already 5 place questions waiting for an answer. Wait for those first.", or the 100-a-day sentence), exactly as a second ask made a moment later would be.
-- Needs 20261104000300 (and, for the other two, 20261104000400 and 20261104000500 where they are applied). Undo: supabase/rollbacks/20261109000300_ask_locks_rollback.sql.

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
    if position('pg_advisory_xact_lock' in def) > 0 then continue; end if;       -- already locked
    n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
    if n <> 1 then
      raise exception 'The function % is not as expected (its first lines were found % times, not once); nothing was changed.', f.proname, n;
    end if;
    execute replace(def, anchor, locked);
  end loop;
end $$;

select ryagram_private.gate_apply();
commit;

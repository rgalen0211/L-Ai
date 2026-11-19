-- FILM CARD FAILED AGE (CONNECT, 2026-11-19; GAMES' second review of the card retry, finding 2). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES ONE LIVE FUNCTION (public.connect_film_card_get).
-- Why: the card read says whether a failed picture may be asked for again (retry, after 10 minutes) but not how long ago it failed, so an open chat panel times its "you can try again now" re-read from when IT saw the failure
-- (up to 10 min 20 s late for a picture that failed before the panel opened). This adds ONE number to the two places the read already describes a failed request: failed_s, the whole seconds since it failed (never below 0).
-- It is null for any request that has not failed. It names no film, no person and no story text; the rule that decides a retry (engine_error, older than 10 minutes) is not touched.
-- HOW: the function is not copied here: it reads the LIVE function's own text (pg_get_functiondef, which includes the waiting-list guard the gate put in it), adds exactly the two pieces of text, and runs that.
-- It first checks it is the function it expects (the two lines it extends each occur once); anything else stops with a plain sentence and changes nothing (the whole file is one transaction); already changed, it leaves it alone
-- (safe to run twice). Owner, grants and settings are kept. Nothing else is touched: no new function, no new table, no new column.
-- Needs 20261109000100_film_cards.sql. Undo: supabase/rollbacks/20261119000100_film_card_failed_age_rollback.sql. Check: supabase/live-steps/26_film_card_failed_age_after_check.sql.
-- A connector or panel that does not know failed_s ignores it; the panel falls back to its fixed wait when it is missing (an older database), so the order of deploys does not matter.

begin;

do $do$
declare
  def text; neu text;
  top_old constant text := '''fail_detail'', r.fail_detail, ''retry'', retry,';
  top_new constant text := '''fail_detail'', r.fail_detail, ''retry'', retry, ''failed_s'', case when r.state = ''failed'' then greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int) end,';
  ref_old constant text := 'jsonb_build_object(''state'', r.state, ''fail_code'', r.fail_code, ''retry'', retry)';
  ref_new constant text := 'jsonb_build_object(''state'', r.state, ''fail_code'', r.fail_code, ''retry'', retry, ''failed_s'', case when r.state = ''failed'' then greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int) end)';
  n_top int; n_ref int;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.connect_film_card_get(text, uuid)');
  if def is null then raise notice 'connect_film_card_get is not on this database: skipped.'; return; end if;
  if position(top_new in def) > 0 and position(ref_new in def) > 0 then raise notice 'connect_film_card_get: nothing to do (already in the wanted state).'; return; end if;
  n_top := (length(def) - length(replace(def, top_old, ''))) / length(top_old);
  n_ref := (length(def) - length(replace(def, ref_old, ''))) / length(ref_old);
  if position('''refresh''' in def) = 0 or n_top <> 1 or n_ref <> 1 or position('failed_s' in def) > 0 then
    raise exception 'The live function connect_film_card_get is not the one this change expects (its text differs from the repository''s 20261109000100_film_cards.sql); nothing was changed. Send this sentence to CONNECT.';
  end if;
  neu := replace(replace(def, top_old, top_new), ref_old, ref_new);
  execute neu;
end $do$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (nothing new to guard: the function above keeps its guard)
-- Check after running: supabase/live-steps/26_film_card_failed_age_after_check.sql (every ok true).
commit;

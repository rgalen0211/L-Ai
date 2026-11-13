-- FILM CARD CAPS (CONNECT, 2026-11-13; Ryan 2026-11-12 "ship now, hatch next"; CC1's order 20:46 and 21:04). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES ONE LIVE FUNCTION and ONE TABLE CHECK.
-- The film's hatch is the main measure of many films (a state map's obesity shading), and carrying it in the look card needs a bigger picture: the connector's picture cap rose from 200000 to 300000 characters and the card cap
-- from 262144 to 320000 bytes (the picture plus about 6000 for the look colours, the notes and the basis; the real default 13-year state map is a 298154-character picture in a 304468-byte card). This file makes the DATABASE agree:
--   (1) the stored answer's size check on public.film_card_requests (answer): 262144 -> 320000 bytes;
--   (2) public.finish_film_card: the same number in its own size test (what the house worker may store), and ONE new line: after it stores a card it deletes the person's OLDER answered cards beyond the newest 20
--       (a card is drawn again the next time the film is opened in the chat editor, so an old one going costs a minute, never a film; failed rows are small and keep their 30 days). That keeps the largest cards from piling up
--       on the Free plan's 500 MB (about 100 cards at the cap is about 8 MB compressed per person at most).
-- HOW: (2) is not copied here: it reads the LIVE function's own text (pg_get_functiondef, which includes the waiting-list guard the gate put in it), changes exactly the number and adds exactly the one statement, and runs that.
-- It first checks it is the function it expects (its own error sentence is in the text, the number occurs once, the update line occurs once); anything else stops with a plain sentence and changes nothing (the whole file is one
-- transaction); already changed, it leaves it alone (safe to run twice). Owner, grants and settings are kept. Nothing else is touched: no new function, no new table.
-- Needs 20261109000100_film_cards.sql. Undo: supabase/rollbacks/20261113000100_film_card_caps_rollback.sql (it first deletes answered cards over 262144 bytes, which are drawn again on request). Check: supabase/live-steps/25_film_card_caps_after_check.sql.

begin;

-- (1) the stored answer may be up to 320000 bytes
do $do$
declare c record;
begin
  select conname, pg_get_constraintdef(oid) as def into c from pg_constraint
    where conrelid = 'public.film_card_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%octet_length%answer%';
  if c.conname is null then raise exception 'The size check on film_card_requests.answer is not on this database; nothing was changed. Send this sentence to CONNECT.'; end if;
  if c.def like '%<= 320000%' then raise notice 'film_card_requests.answer: nothing to do (already 320000).'; return; end if;
  if c.def not like '%<= 262144%' then raise exception 'The size check on film_card_requests.answer is not the one this change expects (it is not 262144); nothing was changed. Send this sentence to CONNECT.'; end if;
  execute format('alter table public.film_card_requests drop constraint %I', c.conname);
  alter table public.film_card_requests add constraint film_card_requests_answer_check check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 320000));
end $do$;

-- (2) finish_film_card: the new number, and the newest-20 trim after a card is stored
do $do$
declare
  def text; neu text;
  anchor constant text := 'update public.film_card_requests set state = ''answered'', answer = p_card, finished_at = now(), fail_code = null, fail_detail = null where id = p_id;';
  trim_line constant text := E'\n  delete from public.film_card_requests where owner_id = g.owner_id and state = ''answered'' and id not in (select id from public.film_card_requests where owner_id = g.owner_id and state = ''answered'' order by finished_at desc limit 20);';
  n_cap int; n_anchor int;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.finish_film_card(uuid, jsonb)');
  if def is null then raise notice 'finish_film_card is not on this database: skipped.'; return; end if;
  if def like '%octet_length(p_card::text) > 320000%' and position(trim_line in def) > 0 then raise notice 'finish_film_card: nothing to do (already in the wanted state).'; return; end if;
  n_cap := (length(def) - length(replace(def, 'octet_length(p_card::text) > 262144', ''))) / length('octet_length(p_card::text) > 262144');
  n_anchor := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  if position('That is not a film look card.' in def) = 0 or n_cap <> 1 or n_anchor <> 1 or position('limit 20' in def) > 0 then
    raise exception 'The live function finish_film_card is not the one this change expects (its text differs from the repository''s 20261109000100_film_cards.sql); nothing was changed. Send this sentence to CONNECT.';
  end if;
  neu := replace(replace(def, 'octet_length(p_card::text) > 262144', 'octet_length(p_card::text) > 320000'), anchor, anchor || trim_line);
  execute neu;
end $do$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (nothing new to guard: the function above keeps its guard)
-- Check after running: supabase/live-steps/25_film_card_caps_after_check.sql (every ok true).
commit;

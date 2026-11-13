-- FILM CARD CAPS: the exact undo of migrations/20261113000100_film_card_caps.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts the stored answer's size check back to 262144 bytes and finish_film_card back to its own number and without the newest-20 trim. Cards between 262144 and 320000 bytes could not stay (the old check would refuse
-- them), so they are deleted first: each is drawn again the next time its film is opened in the chat editor (a minute with the house computer on). Nothing else is touched. Same drift checks as the migration: a function or check that
-- is neither the new nor the old one stops it in words and changes nothing (the whole file is one transaction); already undone, it leaves things alone.

begin;

delete from public.film_card_requests where answer is not null and octet_length(answer::text) > 262144;

do $do$
declare c record;
begin
  select conname, pg_get_constraintdef(oid) as def into c from pg_constraint
    where conrelid = 'public.film_card_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%octet_length%answer%';
  if c.conname is null then raise exception 'The size check on film_card_requests.answer is not on this database; nothing was changed. Send this sentence to CONNECT.'; end if;
  if c.def like '%<= 262144%' then raise notice 'film_card_requests.answer: nothing to undo (already 262144).'; return; end if;
  if c.def not like '%<= 320000%' then raise exception 'The size check on film_card_requests.answer is not the one this undo expects (it is not 320000); nothing was changed. Send this sentence to CONNECT.'; end if;
  execute format('alter table public.film_card_requests drop constraint %I', c.conname);
  alter table public.film_card_requests add constraint film_card_requests_answer_check check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 262144));
end $do$;

do $do$
declare
  def text; neu text;
  anchor constant text := 'update public.film_card_requests set state = ''answered'', answer = p_card, finished_at = now(), fail_code = null, fail_detail = null where id = p_id;';
  trim_line constant text := E'\n  delete from public.film_card_requests where owner_id = g.owner_id and state = ''answered'' and id not in (select id from public.film_card_requests where owner_id = g.owner_id and state = ''answered'' order by finished_at desc limit 20);';
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.finish_film_card(uuid, jsonb)');
  if def is null then raise notice 'finish_film_card is not on this database: skipped.'; return; end if;
  if def like '%octet_length(p_card::text) > 262144%' and position(trim_line in def) = 0 then raise notice 'finish_film_card: nothing to undo (already the original).'; return; end if;
  if position('That is not a film look card.' in def) = 0 or def not like '%octet_length(p_card::text) > 320000%' or position(trim_line in def) = 0 then
    raise exception 'The live function finish_film_card is not the one this undo expects (it is neither the original nor the capped text); nothing was changed. Send this sentence to CONNECT.';
  end if;
  neu := replace(replace(def, trim_line, ''), 'octet_length(p_card::text) > 320000', 'octet_length(p_card::text) > 262144');
  execute neu;
end $do$;

commit;

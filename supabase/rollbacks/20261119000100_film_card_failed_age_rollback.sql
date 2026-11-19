-- FILM CARD FAILED AGE: the exact undo of migrations/20261119000100_film_card_failed_age.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It takes the failed_s number back out of connect_film_card_get and my_film_card_get (both places in each). Nothing else is touched. Same drift check as the migration: a function that is neither the new nor the original text stops it
-- in words and changes nothing (the whole file is one transaction); already undone, it leaves things alone. A connector or panel that was built for failed_s keeps working without it (it falls back to its fixed wait).

begin;

do $do$
declare
  fn text; def text; neu text;
  top_old constant text := '''fail_detail'', r.fail_detail, ''retry'', retry,';
  top_new constant text := '''fail_detail'', r.fail_detail, ''retry'', retry, ''failed_s'', case when r.state = ''failed'' then greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int) end,';
  ref_old constant text := 'jsonb_build_object(''state'', r.state, ''fail_code'', r.fail_code, ''retry'', retry)';
  ref_new constant text := 'jsonb_build_object(''state'', r.state, ''fail_code'', r.fail_code, ''retry'', retry, ''failed_s'', case when r.state = ''failed'' then greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int) end)';
  todo text[] := '{}';
begin
  foreach fn in array array['public.connect_film_card_get(text, uuid)', 'public.my_film_card_get(uuid)'] loop
    select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure(fn);
    if def is null then raise notice '% is not on this database: skipped.', fn; continue; end if;
    if position('failed_s' in def) = 0 then raise notice '%: nothing to undo (already the original).', fn; continue; end if;
    if position(top_new in def) = 0 or position(ref_new in def) = 0 then
      raise exception 'The live function % is not the one this undo expects (it is neither the original nor the failed_s text); nothing was changed. Send this sentence to CONNECT.', fn;
    end if;
    todo := todo || fn;
  end loop;
  foreach fn in array todo loop
    select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure(fn);
    neu := replace(replace(def, top_new, top_old), ref_new, ref_old);
    execute neu;
  end loop;
end $do$;

commit;

-- UNDO 20261113000500_my_film_cards.sql: removes exactly the two site functions. No request row, card or other function is touched (the connector's own twins and the worker's functions stay as they are).
begin;
drop function if exists public.my_film_card_ask(uuid);
drop function if exists public.my_film_card_get(uuid);
commit;

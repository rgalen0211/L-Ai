-- FILM LOOK CARDS: the exact undo of migrations/20261109000100_film_cards.sql (CONNECT, editor Step A). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every film card request and card (they are drawn again on request; kept 30 days at most). Nothing else is touched. Turn WORKER's film-card job off first.
begin;
drop function if exists public.film_card_purge();
drop function if exists public.fail_film_card(uuid, text, text);
drop function if exists public.finish_film_card(uuid, jsonb);
drop function if exists public.claim_next_film_card();
drop function if exists public.connect_film_card_get(text, uuid);
drop function if exists public.connect_film_card_ask(text, uuid);
drop table if exists public.film_card_requests;
drop function if exists ryagram_private.film_card_sweep();
commit;

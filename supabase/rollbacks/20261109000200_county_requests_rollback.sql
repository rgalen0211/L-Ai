-- COUNTY REQUESTS: the exact undo of migrations/20261109000200_county_requests.sql (CONNECT, BACKLOG CONNECT-4). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every county request and answer (questions and short-lived answers, kept 7 days at most). Nothing else is touched. Turn WORKER's county job off first.
begin;
drop function if exists public.county_purge();
drop function if exists public.fail_county(uuid, text, text);
drop function if exists public.finish_county(uuid, jsonb);
drop function if exists public.claim_next_county();
drop function if exists public.connect_county_get(text, uuid);
drop function if exists public.connect_county_ask(text, text, text[], text, text, int);
drop table if exists public.county_requests;
drop function if exists ryagram_private.county_list_ok(text[]);
commit;

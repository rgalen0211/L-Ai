-- GEO REQUESTS: the exact undo of migrations/20261104000300_geo_requests.sql (NEXT-CONNECT 196). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every geo request (they were questions and short-lived answers, kept 7 days at most). Nothing else is touched. Turn WORKER's geo step off first.
begin;
drop function if exists public.geo_purge();
drop function if exists public.fail_geo(uuid, text, text);
drop function if exists public.finish_geo(uuid, jsonb);
drop function if exists public.claim_next_geo();
drop function if exists public.connect_geo_get(text, uuid);
drop function if exists public.connect_geo_ask(text, double precision, double precision, int, text[]);
drop table if exists public.geo_requests;
drop function if exists ryagram_private.geo_categories_ok(text[]);
commit;

-- PERFECT CITY: the exact undo of migrations/20261127000900_perfect_city_places.sql (GEO, 2026-11-27). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Turn the Perfect City switch off first, or the page asks for a function that is gone. What is lost: the loaded
-- places and block groups (both came from files and can be loaded again). Nothing else changes: the per-account switch lists are untouched.
begin;
drop function if exists ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision);
drop function if exists public.perfect_city_places(text, text, double precision, double precision);
drop function if exists ryagram_private.perfect_city_check(uuid, text, text, double precision, double precision);
drop function if exists ryagram_private.perfect_city_km(double precision, double precision, double precision, double precision);
drop table if exists ryagram_private.perfect_city_units;
drop table if exists ryagram_private.perfect_city_places;
commit;

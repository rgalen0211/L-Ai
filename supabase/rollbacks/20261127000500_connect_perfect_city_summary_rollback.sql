-- THE PERFECT CITY NUMBERS FOR A SPOT, FOR THE PERSON'S AI: the exact undo of migrations/20261127000500_connect_perfect_city_summary.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- (It has no gate_apply line: the migration's one function is the connector login's only, so the gate has nothing to change on the way out.)
-- It removes the one function and nothing else (GEO's helper, its tables and the page's own function are untouched). The connector's perfect_city_summary then says that Perfect City is not available just now and looks nothing up.

begin;
drop function if exists public.connect_perfect_city_summary(text, text, text, double precision, double precision);
commit;

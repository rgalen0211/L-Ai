-- THE PERFECT CITY NUMBERS FOR A SPOT, FOR THE PERSON'S AI (CONNECT, 2026-11-27; the Perfect City department's connector tool perfect_city_summary). NOT APPLIED: a PROPOSAL for GEO, BUILDER and CC1; Ryan applies it. It ADDS one function and changes nothing.
-- Perfect City's page (GEO) shows, for a spot the person puts on a county map: the nearest similar places (straight-line distance), how many lie within 1, 2 and 5 km, and about how many people live in each ring, every number labelled calculated or
-- estimated. GEO's migration 20261127000900_perfect_city_places.sql adds the PRIVATE helper that works those numbers out for one OWNER:
--     ryagram_private.perfect_city_summary_for(p_owner uuid, p_county text, p_kind text, p_lat double precision, p_lon double precision) returns jsonb
-- It refuses 42501 unless that owner has 'perfectCity' in account_settings.switches_on (or is an app admin), 22023 for an unknown county or kind or a spot outside the county, rounds the spot to 4 decimals, and answers
-- schema ryagram.perfect-city-summary/0 (the exact shape is in proposals/CONNECT-DEPT-PERFECT-CITY-1127.md, part B). The AI has no session: it holds a token the person gave it. THIS is the token-checked twin: it resolves the person from the token
-- on every call (connect_actor, scope 'read'), takes NO owner argument, checks the arguments are present and in range in plain words, and hands the person's own id to GEO's helper. It writes nothing, starts nothing, touches no credit,
-- and never reads a table itself: the places, the Census rows and the switch check are GEO's helper's.
-- ORDER: needs 20261018000100_connect_ai.sql. It does NOT need GEO's migration: until ryagram_private.perfect_city_summary_for exists the call raises the plain sentence 'Perfect City is not available yet.' (errcode PT503), and the connector's tool says
-- that nothing was looked up. GEO's helper must be REVOKED from public (the after-check says false if the connector login can run it directly).
-- Undo: supabase/rollbacks/20261127000500_connect_perfect_city_summary_rollback.sql. Check: supabase/live-steps/66b_connect_perfect_city_summary_check.sql.

begin;

create function public.connect_perfect_city_summary(p_token_hash text, p_county text, p_kind text, p_lat double precision, p_lon double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  answer jsonb;
begin
  if p_county is null or p_kind is null or p_county !~ '^[a-z][a-z0-9_]{1,30}$' or p_kind !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'Give a place and a kind of business, each a short lowercase name from the options Perfect City lists.' using errcode = '22023';
  end if;
  if p_lat is null or p_lon is null or p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    raise exception 'Give a latitude from -90 to 90 and a longitude from -180 to 180.' using errcode = '22023';
  end if;
  if to_regprocedure('ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)') is null then
    raise exception 'Perfect City is not available yet.' using errcode = 'PT503';
  end if;
  execute 'select ryagram_private.perfect_city_summary_for($1, $2, $3, $4, $5)' into answer using me, p_county, p_kind, p_lat, p_lon;
  return answer;
end $$;

revoke execute on function public.connect_perfect_city_summary(text, text, text, double precision, double precision) from public, anon, authenticated, service_role;
grant execute on function public.connect_perfect_city_summary(text, text, text, double precision, double precision) to connect_runner;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (the function is the connector login's only, so the gate leaves it as it is)
commit;

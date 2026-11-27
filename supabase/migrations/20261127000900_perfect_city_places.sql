-- PERFECT CITY, DATABASE HALF (GEO, 2026-11-27). NOT APPLIED: a PROPOSAL; Ryan applies it (live step PC1, proposals/GEO-PERFECT-CITY-LIVE-STEPS-1127.md).
-- What it adds, and nothing else:
--   * ryagram_private.perfect_city_places: one row per business place (county, kind, osm_ref, name, lat, lon). EMPTY here: the rows are OpenStreetMap
--     data (ODbL; attorney row G11 open), loaded by the dashboard from a file OUTSIDE every repo (live step PC2). Closed to every API role.
--   * ryagram_private.perfect_city_units: the Census block groups' centres and populations (public domain), loaded from
--     supabase/live-steps/perfect_city_units_seed.sql (live step PC2b), generated from the page's own data so the server's numbers match the page's.
--   * public.perfect_city_places(county, kind, lat, lon): for ONE spot, the places within 5 km of it plus the nearest five (never a whole county in one
--     call: RENDERER 08:24, the licence question), with how many are loaded and the OpenStreetMap credit; never the osm_ref. Signed in only, and only for
--     an account whose per-account switch list names 'perfectCity', an app admin, or everyone once the department is 'working' (the public flip); else 42501. Unknown county or kind, or a spot outside the county: 22023.
--   * ryagram_private.perfect_city_summary_for(owner, county, kind, lat, lon): the AI tool's summary (CONNECT wraps it with its token check), the same gate
--     for that owner, schema ryagram.perfect-city-summary/0 (proposals/CONNECT-DEPT-PERFECT-CITY-1127.md part B).
--   * ryagram_private.perfect_city_km and perfect_city_check: the haversine distance (the same formula as assets/perfect-city-core.js) and the shared gate.
--   * LIMITS (RENDERER 08:40/08:43, so the private table cannot be rebuilt by stepping a spot across a county): at most 60 places per call, and a per-account
--     per-day call count in ryagram_private.perfect_city_calls (300 a day with the switch, 40 a day for an account let in only by the public flip; admins 2,000),
--     refused in words (54000) past it. Every helper is closed to service_role too.
-- Apply AFTER: 20260928000300_2a_worker_is_not_a_person.sql (require_signed_in), 20261003000300_admin_waitlist_by_film.sql (app_admins),
-- 20261110000400_account_switches.sql (switches_on), 20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
-- Undo: supabase/rollbacks/20261127000900_perfect_city_places_rollback.sql (every object below; the loaded rows are lost, nothing else).

begin;

create table ryagram_private.perfect_city_places (
  county text not null check (county in ('montgomery_oh', 'greene_oh')),
  kind text not null check (kind in ('fast_food', 'restaurant', 'grocery', 'chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian')),
  osm_ref text not null,
  name text not null default '',
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  primary key (county, kind, osm_ref));
revoke all on ryagram_private.perfect_city_places from public, anon, authenticated, service_role;
alter table ryagram_private.perfect_city_places enable row level security;     -- no policy: a second lock behind the revoked grants

create table ryagram_private.perfect_city_units (
  county text not null check (county in ('montgomery_oh', 'greene_oh')),
  geoid text not null check (geoid ~ '^39[0-9]{10}$'),
  pop integer not null check (pop >= 0),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  primary key (county, geoid));
revoke all on ryagram_private.perfect_city_units from public, anon, authenticated, service_role;
alter table ryagram_private.perfect_city_units enable row level security;

-- One row per account per day (UTC): how many Perfect City calls it made. Closed to every API role; kept small (one row per account per day).
create table ryagram_private.perfect_city_calls (
  owner_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  calls integer not null default 0 check (calls >= 0),
  primary key (owner_id, day));
revoke all on ryagram_private.perfect_city_calls from public, anon, authenticated, service_role;
alter table ryagram_private.perfect_city_calls enable row level security;

-- Great-circle distance in km (haversine, mean Earth radius 6371.0088 km): the same formula as assets/perfect-city-core.js km().
create function ryagram_private.perfect_city_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language plpgsql immutable set search_path = '' as $$
begin
  return 2 * 6371.0088 * asin(least(1.0, sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
                                               + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))));
end $$;
revoke execute on function ryagram_private.perfect_city_km(double precision, double precision, double precision, double precision) from public, anon, authenticated, service_role;

-- The one check every Perfect City call makes: an owner with the switch, or an app admin; a known county and kind (no supermarkets in Greene); a spot inside
-- the county's box (from its loaded block groups, 0.05 degrees of margin). Raises in words; returns nothing.
create function ryagram_private.perfect_city_check(p_owner uuid, p_county text, p_kind text, p_lat double precision, p_lon double precision)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare box record; is_admin boolean; has_switch boolean; cap integer; used integer;
begin
  -- Who may: the owner's own switch, an app admin, or the department opened for everyone (departments.status 'working', the public flip; CC1 08:10).
  is_admin := p_owner is not null and exists (select 1 from public.app_admins a where a.user_id = p_owner);
  has_switch := p_owner is not null and exists (select 1 from public.account_settings s where s.owner_id = p_owner and 'perfectCity' = any (s.switches_on));
  if p_owner is null or not (is_admin or has_switch
                             or exists (select 1 from public.departments d where d.id = 'geo_intelligence' and d.status = 'working')) then
    raise exception 'Perfect City is not switched on for this account.' using errcode = '42501';
  end if;
  -- the day's call count (UTC day), counted before any other check so a refused call still counts
  cap := case when is_admin then 2000 when has_switch then 300 else 40 end;
  insert into ryagram_private.perfect_city_calls as c (owner_id, day, calls) values (p_owner, (now() at time zone 'utc')::date, 1)
    on conflict (owner_id, day) do update set calls = c.calls + 1
    returning c.calls into used;
  if used > cap then
    raise exception 'This account has reached today''s limit of % Perfect City requests (refused ones count too). Try again tomorrow.', cap using errcode = '54000';
  end if;
  if p_county is null or p_county not in ('montgomery_oh', 'greene_oh') then
    raise exception 'Choose a county: montgomery_oh or greene_oh.' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('fast_food', 'restaurant', 'grocery', 'chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian') or (p_county = 'greene_oh' and p_kind = 'grocery') then
    raise exception 'Choose a kind this county has: fast_food, restaurant, chicken, burger, pizza, sandwich, mexican or asian (grocery in montgomery_oh only).' using errcode = '22023';
  end if;
  select min(u.lat) - 0.05 as lat0, max(u.lat) + 0.05 as lat1, min(u.lon) - 0.05 as lon0, max(u.lon) + 0.05 as lon1 into box
    from ryagram_private.perfect_city_units u where u.county = p_county;
  if box.lat0 is null then
    raise exception 'The county data is not loaded yet.' using errcode = '22023';
  end if;
  if p_lat is null or p_lon is null or p_lat not between box.lat0 and box.lat1 or p_lon not between box.lon0 and box.lon1 then
    raise exception 'That spot is outside the county. Give a latitude and longitude inside it.' using errcode = '22023';
  end if;
end $$;
revoke execute on function ryagram_private.perfect_city_check(uuid, text, text, double precision, double precision) from public, anon, authenticated, service_role;

-- The page's call: the places near ONE spot (within 5 km, plus the nearest five), never a whole county.
create function public.perfect_city_places(p_county text, p_kind text, p_lat double precision, p_lon double precision) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in();       -- no visitor, no worker account
begin
  perform ryagram_private.perfect_city_check(me, p_county, p_kind, p_lat, p_lon);
  return (select jsonb_build_object('county', p_county, 'kind', p_kind, 'radius_km', 5, 'max_places', 60, 'credit', 'Map data (c) OpenStreetMap contributors (ODbL)',
                                    'loaded', (select count(*) from ryagram_private.perfect_city_places a where a.county = p_county and a.kind = p_kind),
                                    'places', coalesce(jsonb_agg(jsonb_build_object('name', n.name, 'lat', n.lat, 'lon', n.lon) order by n.km, n.name, n.osm_ref), '[]'::jsonb))
            from (select p.name, p.lat, p.lon, p.osm_ref, ryagram_private.perfect_city_km(p_lat, p_lon, p.lat, p.lon) as km,
                         row_number() over (order by ryagram_private.perfect_city_km(p_lat, p_lon, p.lat, p.lon), p.name, p.osm_ref) as rn
                    from ryagram_private.perfect_city_places p where p.county = p_county and p.kind = p_kind) n
           where (n.km <= 5 or n.rn <= 5) and n.rn <= 60);                       -- never more than 60 places in one answer
end $$;
revoke all on function public.perfect_city_places(text, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.perfect_city_places(text, text, double precision, double precision) to authenticated;

-- For ONE owner (the connector resolves the owner from its token first): the summary for a spot, in CONNECT's shape ryagram.perfect-city-summary/0.
-- Every number carries its basis word; distances are straight lines; people are the page's own estimate (block groups whose centre is inside the ring).
create function ryagram_private.perfect_city_summary_for(p_owner uuid, p_county text, p_kind text, p_lat double precision, p_lon double precision)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lat double precision := round(p_lat::numeric, 4)::double precision;
  v_lon double precision := round(p_lon::numeric, 4)::double precision;
  loaded int;
begin
  perform ryagram_private.perfect_city_check(p_owner, p_county, p_kind, v_lat, v_lon);
  select count(*) into loaded from ryagram_private.perfect_city_places p where p.county = p_county and p.kind = p_kind;
  return jsonb_build_object(
    'schema', 'ryagram.perfect-city-summary/0',
    'place', p_county, 'business_type', p_kind,
    'spot', jsonb_build_object('lat', v_lat, 'lon', v_lon, 'is_default', false),
    'places_loaded', jsonb_build_object('count', loaded, 'basis', 'calculated'),
    -- no business NAMES reach a person's AI while attorney row G11 is open (CONNECT's rule): rank and distance only; the page shows names to its own account
    'nearest', coalesce((select jsonb_agg(jsonb_build_object('rank', n.rk, 'km', round(n.km::numeric, 2), 'basis', 'calculated') order by n.rk)
                           from (select row_number() over (order by ryagram_private.perfect_city_km(v_lat, v_lon, p.lat, p.lon), p.name, p.osm_ref) as rk,
                                        ryagram_private.perfect_city_km(v_lat, v_lon, p.lat, p.lon) as km
                                   from ryagram_private.perfect_city_places p where p.county = p_county and p.kind = p_kind
                                  order by 2, p.name, p.osm_ref limit 5) n), '[]'::jsonb),
    'rings', (select jsonb_agg(jsonb_build_object(
                'km', r.km,
                'places', jsonb_build_object('count', (select count(*) from ryagram_private.perfect_city_places p
                                                        where p.county = p_county and p.kind = p_kind and ryagram_private.perfect_city_km(v_lat, v_lon, p.lat, p.lon) <= r.km),
                                             'basis', 'calculated'),
                -- People only for the 5 km ring: the server has block-group CENTRES only, and GEO's 11-27 check (proposals/GEO-PERFECT-CITY-ESTIMATE-CHECK-1127.md)
                -- found the centre method off by a median 4% at 5 km but 18% at 2 km and 58% at 1 km, with false zeros. The page itself uses area weighting.
                'people_about', case when r.km = 5 then
                    jsonb_build_object('value', (select (round(coalesce(sum(u.pop), 0) / 100.0) * 100)::int from ryagram_private.perfect_city_units u
                                                  where u.county = p_county and ryagram_private.perfect_city_km(v_lat, v_lon, u.lat, u.lon) <= r.km),
                                       'basis', 'estimated',
                                       'method', 'block groups whose centre is inside the ring, counted in full, rounded to the nearest 100; typically within about 10 percent at 5 km')
                  else jsonb_build_object('value', null, 'basis', 'estimated',
                                          'note', 'not given for rings under 5 km: too rough from block-group centres; the Perfect City page shows an area-weighted figure')
                  end)
                order by r.km)
              from (values (1), (2), (5)) r(km)),
    'not_known', jsonb_build_array(
      'Distances are straight lines, not drive or walk times.',
      'The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.',
      'People are given for the 5 km ring only, as an estimate from block-group centres.',
      'There is no success score and no prediction. This shows what is there, not whether a business would do well.'),
    'credits', jsonb_build_array(
      'U.S. Census Bureau, 2020 Census, table P1 (total population), block groups.',
      'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.',
      'Map data (c) OpenStreetMap contributors (ODbL)'));
end $$;
revoke execute on function ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision) from public, anon, authenticated, service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list: the gate covers what a signed-in account can run

commit;

-- FORECAST REQUESTS: the exact undo of migrations/20261104000500_forecast_requests.sql. NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every forecast request (short-lived: kept 7 days at most) and puts the three replaced functions back as 20261104000400 made them. The place questions' rows are untouched.
-- Turn WORKER's forecast step off first. Run the gate again at the end (it is in this file) so the restored functions get the waiting-list check back.
begin;
delete from public.geo_requests where shape = 'forecast';
drop function if exists public.claim_next_forecast();
drop function if exists public.connect_forecast_ask(text, jsonb, int, text, int[], text);

create or replace function public.connect_geo_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); g public.geo_requests;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  select * into g from public.geo_requests where id = p_id and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', g.id, 'state', g.state, 'shape', g.shape, 'lat', g.lat, 'lon', g.lon, 'lat_b', g.lat_b, 'lon_b', g.lon_b, 'minutes', g.minutes, 'categories', to_jsonb(g.categories),
                            'category', g.category, 'town', g.town, 'answer', g.answer, 'fail_code', g.fail_code, 'fail_detail', g.fail_detail,
                            'waited_s', floor(extract(epoch from (coalesce(g.finished_at, now()) - g.asked_at)))::int);
end $$;

create or replace function public.claim_next_geo_question() returns table (request_id uuid, shape text, lat double precision, lon double precision, lat_b double precision, lon_b double precision, category text, town text)
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select r.* into g from public.geo_requests r
    where r.shape <> 'within_minutes' and (r.state = 'asked' or (r.state = 'claimed' and r.claimed_at < now() - interval '10 minutes')) and r.asked_at > now() - interval '7 days'
    order by r.asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.shape, g.lat, g.lon, g.lat_b, g.lon_b, g.category, g.town;
end $$;

create or replace function public.finish_geo(p_id uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); g public.geo_requests;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or p_answer ->> 'schema' is null or p_answer ->> 'schema' not in ('ryagram.drive-estimate/0', 'ryagram.geo-ask/0') or octet_length(p_answer::text) > 65536 then
    raise exception 'That is not a drive estimate or a place-question answer.' using errcode = '22023';
  end if;
  select * into g from public.geo_requests where id = p_id and state = 'claimed' for update;
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
  if (g.shape = 'within_minutes') <> (p_answer ->> 'schema' = 'ryagram.drive-estimate/0') then
    raise exception 'That answer is not for this kind of question.' using errcode = '22023';
  end if;
  update public.geo_requests set state = 'answered', answer = p_answer, finished_at = now(), fail_code = null, fail_detail = null where id = p_id and state = 'claimed';
end $$;

alter table public.geo_requests drop constraint geo_requests_forecast_fields;
alter table public.geo_requests drop constraint geo_requests_shape_fields;
alter table public.geo_requests add constraint geo_requests_shape_fields check (
  (shape = 'within_minutes' and lat is not null and lon is not null and minutes is not null and lat_b is null and lon_b is null and category is null and town is null)
  or (shape = 'compare_sites' and lat is not null and lon is not null and lat_b is not null and lon_b is not null and minutes is null and category is null and town is null and categories = '{}')
  or (shape = 'verdict' and lat is not null and lon is not null and category is not null and lat_b is null and lon_b is null and minutes is null and town is null and categories = '{}')
  or (shape = 'where_to_go' and category is not null and lat is null and lon is null and lat_b is null and lon_b is null and minutes is null and categories = '{}')
);
alter table public.geo_requests drop constraint geo_requests_shape_check;
alter table public.geo_requests add constraint geo_requests_shape_check check (shape in ('within_minutes', 'compare_sites', 'verdict', 'where_to_go'));
alter table public.geo_requests drop column unit, drop column breaks, drop column method, drop column horizon, drop column series;
select ryagram_private.gate_apply();
commit;

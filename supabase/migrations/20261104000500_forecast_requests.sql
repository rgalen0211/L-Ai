-- FORECAST REQUESTS (Claude 19:35 item 2: "connector tools for the new departments, OFF by switch: forecast"). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Stacked on 20261104000400_geo_questions.sql.
-- Nothing happens until the connector's `forecast` switch is wired (it is not) and WORKER's forecast step is switched on (it does not exist yet).
-- "Forecast this series": the person's AI hands over a short series of years and numbers (6 to 120 pairs) it was given or has read; the connector cannot compute a forecast (no Python), so it writes a REQUEST in the same table
-- as the place questions; the house worker claims it, runs ENGINE's ryagram.predict.forecast AS IS on the series and writes back ONLY a ryagram.forecast-answer/0 (the forecast dictionary, Estimated, with its band and its backtest);
-- the connector checks every number is labelled Estimated, that the band widens and that the backtest is there, and shows it. No Ryagram dataset is read: the numbers are the ones the person's AI supplied, and the answer says so.
-- Same privacy and size rules as the geo requests: the table is closed to every API role, a row is kept 7 days, the same caps (5 open, 100 a day, with the place questions), the waiting-list gate (gate_apply at the end).
-- Undo: supabase/rollbacks/20261104000500_forecast_requests_rollback.sql.

begin;

alter table public.geo_requests drop constraint geo_requests_shape_check;
alter table public.geo_requests add constraint geo_requests_shape_check check (shape in ('within_minutes', 'compare_sites', 'verdict', 'where_to_go', 'forecast'));
alter table public.geo_requests
  add column series jsonb check (series is null or (jsonb_typeof(series) = 'array' and jsonb_array_length(series) between 6 and 120 and octet_length(series::text) <= 8192)),
  add column horizon int check (horizon is null or horizon between 1 and 10),
  add column method text check (method is null or method in ('linear', 'log', 'moving_average')),
  add column breaks int[] check (breaks is null or (cardinality(breaks) <= 5 and array_position(breaks, null) is null)),
  add column unit text check (unit is null or unit ~ '^[A-Za-z%$ ./-]{1,30}$');
alter table public.geo_requests drop constraint geo_requests_shape_fields;
alter table public.geo_requests add constraint geo_requests_shape_fields check (
  (shape = 'within_minutes' and lat is not null and lon is not null and minutes is not null and lat_b is null and lon_b is null and category is null and town is null)
  or (shape = 'compare_sites' and lat is not null and lon is not null and lat_b is not null and lon_b is not null and minutes is null and category is null and town is null and categories = '{}')
  or (shape = 'verdict' and lat is not null and lon is not null and category is not null and lat_b is null and lon_b is null and minutes is null and town is null and categories = '{}')
  or (shape = 'where_to_go' and category is not null and lat is null and lon is null and lat_b is null and lon_b is null and minutes is null and categories = '{}')
  or (shape = 'forecast' and lat is null and lon is null and lat_b is null and lon_b is null and minutes is null and category is null and town is null and categories = '{}')
);
alter table public.geo_requests add constraint geo_requests_forecast_fields check (
  (shape = 'forecast') = (series is not null and horizon is not null) and (shape = 'forecast' or (method is null and breaks is null and unit is null))
);

-- ---------------------------------------------------------------- the AI asks for a forecast (token-checked; no function takes an owner)
create function public.connect_forecast_ask(p_token_hash text, p_series jsonb, p_horizon int, p_method text, p_breaks int[], p_unit text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  brk int[]; un text; same public.geo_requests; waiting int; today int; nid uuid;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  if p_series is null or (case when jsonb_typeof(p_series) <> 'array' then true else (jsonb_array_length(p_series) not between 6 and 120 or octet_length(p_series::text) > 8192) end) then
    raise exception 'Give 6 to 120 pairs of a year and a number.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_series) e
              where case                                                               -- CASE, not OR: a branch that would fail on a wrong type is never reached
                      when jsonb_typeof(e) <> 'array' then true
                      when jsonb_array_length(e) <> 2 then true
                      when jsonb_typeof(e -> 0) <> 'number' or jsonb_typeof(e -> 1) <> 'number' then true
                      when (e ->> 0) !~ '^[0-9]{4}$' then true
                      else abs((e ->> 1)::numeric) > 1000000000000000
                    end) then
    raise exception 'Each pair is a four-digit whole year and a number.' using errcode = '22023';
  end if;
  if exists (select 1 from (select (e ->> 0)::int as y, lag((e ->> 0)::int) over (order by ord) as prev from jsonb_array_elements(p_series) with ordinality t(e, ord)) s where s.prev is not null and s.y <= s.prev) then
    raise exception 'The years must go forward, each once.' using errcode = '22023';
  end if;
  if p_horizon is null or p_horizon not between 1 and 10 then
    raise exception 'Give a whole number of years ahead from 1 to 10.' using errcode = '22023';
  end if;
  if p_method is not null and p_method not in ('linear', 'log', 'moving_average') then
    raise exception 'The methods are linear, log and moving_average.' using errcode = '22023';
  end if;
  brk := (select array_agg(distinct b order by b) from unnest(coalesce(p_breaks, '{}')) b);
  if brk is not null and (cardinality(brk) > 5 or exists (select 1 from unnest(brk) b where b is null or b not between 1000 and 2200)) then
    raise exception 'A method break is a year, at most five of them.' using errcode = '22023';
  end if;
  un := nullif(btrim(coalesce(p_unit, '')), '');
  if un is not null and un !~ '^[A-Za-z%$ ./-]{1,30}$' then
    raise exception 'A unit is a short word, like people or percent.' using errcode = '22023';
  end if;
  select * into same from public.geo_requests
    where owner_id = me and shape = 'forecast' and series = p_series and horizon = p_horizon and method is not distinct from p_method and breaks is not distinct from brk and unit is not distinct from un
      and state <> 'failed' and asked_at > now() - interval '10 minutes'
    order by asked_at desc limit 1;
  if found then
    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);
  end if;
  select count(*) into waiting from public.geo_requests where owner_id = me and state in ('asked', 'claimed');
  if waiting >= 5 then
    raise exception 'There are already 5 place questions waiting for an answer. Wait for those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.geo_requests where owner_id = me and asked_at > now() - interval '24 hours';
  if today >= 100 then
    raise exception 'That is 100 place questions in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.geo_requests (owner_id, shape, series, horizon, method, breaks, unit) values (me, 'forecast', p_series, p_horizon, p_method, brk, un) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

revoke execute on function public.connect_forecast_ask(text, jsonb, int, text, int[], text) from public, anon, authenticated;
grant execute on function public.connect_forecast_ask(text, jsonb, int, text, int[], text) to connect_runner;

-- the read: the same function as for places, with the forecast's own fields added (the series itself is not returned: the answer carries what was used)
create or replace function public.connect_geo_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); g public.geo_requests;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  select * into g from public.geo_requests where id = p_id and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', g.id, 'state', g.state, 'shape', g.shape, 'lat', g.lat, 'lon', g.lon, 'lat_b', g.lat_b, 'lon_b', g.lon_b, 'minutes', g.minutes, 'categories', to_jsonb(g.categories),
                            'category', g.category, 'town', g.town, 'horizon', g.horizon, 'method', g.method, 'unit', g.unit, 'answer', g.answer, 'fail_code', g.fail_code, 'fail_detail', g.fail_detail,
                            'waited_s', floor(extract(epoch from (coalesce(g.finished_at, now()) - g.asked_at)))::int);
end $$;

-- ---------------------------------------------------------------- the house worker
create or replace function public.claim_next_geo_question() returns table (request_id uuid, shape text, lat double precision, lon double precision, lat_b double precision, lon_b double precision, category text, town text)
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select r.* into g from public.geo_requests r
    where r.shape not in ('within_minutes', 'forecast') and (r.state = 'asked' or (r.state = 'claimed' and r.claimed_at < now() - interval '10 minutes')) and r.asked_at > now() - interval '7 days'
    order by r.asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.shape, g.lat, g.lon, g.lat_b, g.lon_b, g.category, g.town;
end $$;

create function public.claim_next_forecast() returns table (request_id uuid, series jsonb, horizon int, method text, breaks int[], unit text)
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select r.* into g from public.geo_requests r
    where r.shape = 'forecast' and (r.state = 'asked' or (r.state = 'claimed' and r.claimed_at < now() - interval '10 minutes')) and r.asked_at > now() - interval '7 days'
    order by r.asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.series, g.horizon, g.method, g.breaks, g.unit;
end $$;

-- finish_geo takes the one kind of answer that belongs to the request: a drive estimate (minutes), a ryagram.geo-ask/0 (the three other place questions), a ryagram.forecast-answer/0 (a forecast)
create or replace function public.finish_geo(p_id uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); g public.geo_requests;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or p_answer ->> 'schema' is null
     or p_answer ->> 'schema' not in ('ryagram.drive-estimate/0', 'ryagram.geo-ask/0', 'ryagram.forecast-answer/0') or octet_length(p_answer::text) > 65536 then
    raise exception 'That is not a drive estimate or a place-question answer.' using errcode = '22023';
  end if;
  select * into g from public.geo_requests where id = p_id and state = 'claimed' for update;
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
  if (case g.shape when 'within_minutes' then 'ryagram.drive-estimate/0' when 'forecast' then 'ryagram.forecast-answer/0' else 'ryagram.geo-ask/0' end) is distinct from p_answer ->> 'schema' then
    raise exception 'That answer is not for this kind of question.' using errcode = '22023';
  end if;
  update public.geo_requests set state = 'answered', answer = p_answer, finished_at = now(), fail_code = null, fail_detail = null where id = p_id and state = 'claimed';
end $$;

revoke execute on function public.claim_next_forecast() from public, anon;
grant execute on function public.claim_next_forecast() to authenticated;

select ryagram_private.gate_apply();                       -- the replaced and the new worker functions get the waiting-list check like every other function a signed-in account can run

commit;

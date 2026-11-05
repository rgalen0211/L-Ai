-- GEO QUESTION SHAPES (NEXT-CONNECT 7 of GEO's queue; Claude 20:35). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Stacked on 20261104000300_geo_requests.sql. Nothing happens until the connector's `geo` switch is wired
-- (it is not) and WORKER's question step is switched on (it does not exist yet).
-- Three more place questions, asked the same way as "what is within N minutes" (a row the house computer answers; the data never leaves it):
--   compare_sites  "Compare these two sites."                       two points
--   verdict        "Will a <category> place at site A succeed?"      one point + a category; the answer is NEVER a yes or no, only counts
--   where_to_go    "Where should a <category> place go in <town>?"   a category + an optional town name; no place is ever picked
-- The old shape keeps its name, its columns and its worker function (claim_next_geo now hands out only the old shape, so WORKER's tested step is unchanged); the new shapes have their own claim function.
-- Same privacy rules as before: closed to every API role, points rounded to 4 decimals, kept 7 days, shared caps (5 open, 100 a day), the waiting-list gate (gate_apply at the end).
-- Undo: supabase/rollbacks/20261104000400_geo_questions_rollback.sql.

begin;

alter table public.geo_requests
  add column shape text not null default 'within_minutes' check (shape in ('within_minutes', 'compare_sites', 'verdict', 'where_to_go')),
  add column lat_b double precision check (lat_b is null or lat_b between -90 and 90),
  add column lon_b double precision check (lon_b is null or lon_b between -180 and 180),
  add column category text check (category is null or category ~ '^[a-z][a-z0-9_]{1,30}$'),
  add column town text check (town is null or town ~ '^[A-Za-z][A-Za-z .''-]{0,39}$');
alter table public.geo_requests alter column lat drop not null, alter column lon drop not null, alter column minutes drop not null;
alter table public.geo_requests add constraint geo_requests_shape_fields check (
  (shape = 'within_minutes' and lat is not null and lon is not null and minutes is not null and lat_b is null and lon_b is null and category is null and town is null)
  or (shape = 'compare_sites' and lat is not null and lon is not null and lat_b is not null and lon_b is not null and minutes is null and category is null and town is null and categories = '{}')
  or (shape = 'verdict' and lat is not null and lon is not null and category is not null and lat_b is null and lon_b is null and minutes is null and town is null and categories = '{}')
  or (shape = 'where_to_go' and category is not null and lat is null and lon is null and lat_b is null and lon_b is null and minutes is null and categories = '{}')
);
-- the answer of a new shape is bounded like the old one (64 kB, from the first migration's column check)

-- ---------------------------------------------------------------- the AI asks one of the new shapes (token-checked; no function takes an owner)
create function public.connect_geo_ask_shape(p_token_hash text, p_shape text, p_lat double precision, p_lon double precision, p_lat_b double precision, p_lon_b double precision, p_category text, p_town text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  la double precision; lo double precision; lb double precision; ob double precision; tw text; same public.geo_requests; waiting int; today int; nid uuid;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  if p_shape is null or p_shape not in ('compare_sites', 'verdict', 'where_to_go') then
    raise exception 'That is not a kind of place question this service knows.' using errcode = '22023';
  end if;
  if p_shape <> 'where_to_go' and (p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180) then
    raise exception 'Give a latitude from -90 to 90 and a longitude from -180 to 180.' using errcode = '22023';
  end if;
  if p_shape = 'compare_sites' and (p_lat_b is null or p_lon_b is null or p_lat_b not between -90 and 90 or p_lon_b not between -180 and 180) then
    raise exception 'Give the second place as a latitude from -90 to 90 and a longitude from -180 to 180.' using errcode = '22023';
  end if;
  if p_shape in ('verdict', 'where_to_go') and (p_category is null or p_category !~ '^[a-z][a-z0-9_]{1,30}$') then
    raise exception 'Give one kind of business as a short lowercase name.' using errcode = '22023';
  end if;
  tw := nullif(btrim(coalesce(p_town, '')), '');
  if p_shape = 'where_to_go' and tw is not null and tw !~ '^[A-Za-z][A-Za-z .''-]{0,39}$' then
    raise exception 'A town name is letters, spaces, full stops, apostrophes and hyphens, up to 40.' using errcode = '22023';
  end if;
  la := case when p_shape = 'where_to_go' then null else round(p_lat::numeric, 4)::double precision end;
  lo := case when p_shape = 'where_to_go' then null else round(p_lon::numeric, 4)::double precision end;
  lb := case when p_shape = 'compare_sites' then round(p_lat_b::numeric, 4)::double precision end;
  ob := case when p_shape = 'compare_sites' then round(p_lon_b::numeric, 4)::double precision end;
  select * into same from public.geo_requests
    where owner_id = me and shape = p_shape and lat is not distinct from la and lon is not distinct from lo and lat_b is not distinct from lb and lon_b is not distinct from ob
      and category is not distinct from (case when p_shape = 'compare_sites' then null else p_category end) and town is not distinct from (case when p_shape = 'where_to_go' then tw end)
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
  insert into public.geo_requests (owner_id, shape, lat, lon, lat_b, lon_b, category, town)
    values (me, p_shape, la, lo, lb, ob, case when p_shape = 'compare_sites' then null else p_category end, case when p_shape = 'where_to_go' then tw end) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

-- The answer (or where the question stands): the old function with the new fields added. Another person's request looks absent.
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

revoke execute on function public.connect_geo_ask_shape(text, text, double precision, double precision, double precision, double precision, text, text) from public, anon, authenticated;
grant execute on function public.connect_geo_ask_shape(text, text, double precision, double precision, double precision, double precision, text, text) to connect_runner;

-- ---------------------------------------------------------------- the house worker
-- claim_next_geo hands out ONLY the old shape now (WORKER's tested step is unchanged); the new shapes have their own claim function
create or replace function public.claim_next_geo() returns table (request_id uuid, lat double precision, lon double precision, minutes int, categories text[])
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select * into g from public.geo_requests
    where shape = 'within_minutes' and (state = 'asked' or (state = 'claimed' and claimed_at < now() - interval '10 minutes')) and asked_at > now() - interval '7 days'
    order by asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.lat, g.lon, g.minutes, g.categories;
end $$;

create function public.claim_next_geo_question() returns table (request_id uuid, shape text, lat double precision, lon double precision, lat_b double precision, lon_b double precision, category text, town text)
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

-- finish_geo takes either answer, but only the kind that belongs to the request: a drive estimate for the old shape, a ryagram.geo-ask/0 for the new ones
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

revoke execute on function public.claim_next_geo_question() from public, anon;
grant execute on function public.claim_next_geo_question() to authenticated;

select ryagram_private.gate_apply();                       -- the replaced and the new worker functions get the waiting-list check like every other function a signed-in account can run

commit;

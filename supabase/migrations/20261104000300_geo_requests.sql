-- GEO REQUESTS (NEXT-CONNECT 196; plan proposals\CONNECT-GEO-WIRING-PLAN-1104.md, CC1 yes 11-04 15:20). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Nothing happens until the connector's `geo` switch is wired
-- (it is not) and WORKER's geo step is switched on (it is OFF).
-- "What is within N minutes of this place" is a question about ONE point. The connector cannot compute it (no engine, no data in an Edge Function), so it writes a REQUEST here; the house worker claims it,
-- runs ENGINE's drive_estimate on its own (synthetic, until Ryan's OK) data and writes back ONLY the engine's ryagram.drive-estimate/0 JSON; the connector reads it back, checks every number is labelled
-- Estimated, and shows it. The data never leaves the house computer.
-- The row holds a person's chosen POINT, so: the table is closed to EVERY API role (only the token-checked connect_geo_* functions and the worker's three functions touch it); the point is ROUNDED to 4 decimals
-- (about 11 metres) before it is stored; a row is kept 7 days and every ask and every purge call deletes older ones; nothing of the point goes in a log or an error message; at most 5 requests open at once
-- and 100 a day per person (the connector adds its own 30 an hour); a waiting-list account is refused by the same gate as everything else (gate_apply at the end covers the worker functions).
-- Needs 20261018000100_connect_ai.sql (connect_actor, connect_runner) and 20261104000100_waiting_accounts.sql. Undo: supabase/rollbacks/20261104000300_geo_requests_rollback.sql.

begin;

create function ryagram_private.geo_categories_ok(p_cats text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_cats is not null and cardinality(p_cats) <= 4 and not exists (select 1 from unnest(p_cats) c where c is null or c !~ '^[a-z][a-z0-9_]{1,30}$')
$$;

create table public.geo_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  minutes int not null check (minutes between 1 and 60),
  categories text[] not null default '{}' check (ryagram_private.geo_categories_ok(categories)),
  state text not null default 'asked' check (state in ('asked', 'claimed', 'answered', 'failed')),
  answer jsonb check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 65536)),
  fail_code text check (fail_code is null or fail_code in ('geo_request_rejected', 'unknown_category', 'data_not_allowed', 'engine_error', 'answer_rejected')),
  fail_detail text check (fail_detail is null or char_length(fail_detail) <= 300),
  asked_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index geo_requests_owner on public.geo_requests (owner_id, asked_at desc);
create index geo_requests_open on public.geo_requests (asked_at) where state in ('asked', 'claimed');
alter table public.geo_requests enable row level security;
revoke all on public.geo_requests from public, anon, authenticated, service_role, connect_runner;      -- no policy at all: no API role reads or writes the table directly

-- ---------------------------------------------------------------- the AI asks (token-checked; no function takes an owner)
create function public.connect_geo_ask(p_token_hash text, p_lat double precision, p_lon double precision, p_minutes int, p_categories text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  la double precision; lo double precision; cats text[]; waiting int; today int; same public.geo_requests; nid uuid;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Give a latitude from -90 to 90 and a longitude from -180 to 180.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 1 and 60 then
    raise exception 'Give a whole number of minutes from 1 to 60.' using errcode = '22023';
  end if;
  cats := coalesce((select array_agg(distinct c order by c) from unnest(coalesce(p_categories, '{}')) c), '{}');
  if not ryagram_private.geo_categories_ok(cats) then
    raise exception 'Categories are up to four short lowercase names.' using errcode = '22023';
  end if;
  la := round(p_lat::numeric, 4)::double precision;
  lo := round(p_lon::numeric, 4)::double precision;
  select * into same from public.geo_requests
    where owner_id = me and lat = la and lon = lo and minutes = p_minutes and categories = cats and state <> 'failed' and asked_at > now() - interval '10 minutes'
    order by asked_at desc limit 1;
  if found then
    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                      -- asking the same thing again is one request, not two
  end if;
  select count(*) into waiting from public.geo_requests where owner_id = me and state in ('asked', 'claimed');
  if waiting >= 5 then
    raise exception 'There are already 5 place questions waiting for an answer. Wait for those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.geo_requests where owner_id = me and asked_at > now() - interval '24 hours';
  if today >= 100 then
    raise exception 'That is 100 place questions in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.geo_requests (owner_id, lat, lon, minutes, categories) values (me, la, lo, p_minutes, cats) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

-- The answer (or where the question stands). Another person's request looks absent. waited_s lets the tool say plainly when the house computer is not picking things up.
create function public.connect_geo_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); g public.geo_requests;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  select * into g from public.geo_requests where id = p_id and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', g.id, 'state', g.state, 'lat', g.lat, 'lon', g.lon, 'minutes', g.minutes, 'categories', to_jsonb(g.categories), 'answer', g.answer,
                            'fail_code', g.fail_code, 'fail_detail', g.fail_detail, 'waited_s', floor(extract(epoch from (coalesce(g.finished_at, now()) - g.asked_at)))::int);
end $$;

revoke execute on function public.connect_geo_ask(text, double precision, double precision, int, text[]), public.connect_geo_get(text, uuid) from public, anon, authenticated;
grant execute on function public.connect_geo_ask(text, double precision, double precision, int, text[]), public.connect_geo_get(text, uuid) to connect_runner;

-- ---------------------------------------------------------------- the house worker (WORKER's geo step; require_worker() is the gate, as for jobs)
create function public.claim_next_geo() returns table (request_id uuid, lat double precision, lon double precision, minutes int, categories text[])
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select * into g from public.geo_requests
    where (state = 'asked' or (state = 'claimed' and claimed_at < now() - interval '10 minutes')) and asked_at > now() - interval '7 days'
    order by asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.lat, g.lon, g.minutes, g.categories;
end $$;

create function public.finish_geo(p_id uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or p_answer ->> 'schema' is distinct from 'ryagram.drive-estimate/0' or octet_length(p_answer::text) > 65536 then
    raise exception 'That is not a drive estimate.' using errcode = '22023';
  end if;
  update public.geo_requests set state = 'answered', answer = p_answer, finished_at = now(), fail_code = null, fail_detail = null where id = p_id and state = 'claimed';
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
end $$;

create function public.fail_geo(p_id uuid, p_code text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  if p_code is null or p_code not in ('geo_request_rejected', 'unknown_category', 'data_not_allowed', 'engine_error', 'answer_rejected') then
    raise exception 'Unknown failure code.' using errcode = '22023';
  end if;
  update public.geo_requests set state = 'failed', fail_code = p_code, fail_detail = left(btrim(coalesce(p_detail, '')), 300), finished_at = now() where id = p_id and state = 'claimed';
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
end $$;

revoke execute on function public.claim_next_geo(), public.finish_geo(uuid, jsonb), public.fail_geo(uuid, text, text) from public, anon;
grant execute on function public.claim_next_geo(), public.finish_geo(uuid, jsonb), public.fail_geo(uuid, text, text) to authenticated;

-- the keep time, for the dashboard or a schedule (every ask and every read purges as well)
create function public.geo_purge() returns int
language sql security definer set search_path = '' as $$ with d as (delete from public.geo_requests where asked_at < now() - interval '7 days' returning 1) select count(*)::int from d $$;
revoke execute on function public.geo_purge() from public, anon, authenticated;
grant execute on function public.geo_purge() to service_role;

revoke execute on function ryagram_private.geo_categories_ok(text[]) from public, anon, authenticated;
select ryagram_private.gate_apply();                       -- the worker functions get the waiting-list check like every other function a signed-in account can run

commit;

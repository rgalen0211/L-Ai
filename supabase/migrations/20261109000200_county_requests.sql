-- COUNTY REQUESTS (CONNECT 2026-11-09; BACKLOG CONNECT-4; contract proposals\CONNECT-COUNTY-TOOLS-CONTRACT-1109.md; Ryan's Q528 answers 1 to 3). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Nothing happens until the connector's `county` switch is wired
-- (it is not) and WORKER's county job is built and switched on (it is not).
-- GEO's two county tools (county_profile, compare_counties) run in Python on the house computer; the connector cannot run them. So it writes a REQUEST here; the house worker claims it, runs GEO's tool on the worker's own cached files and writes back ONLY the
-- tool's answer; the connector reads it back, checks every figure and every sentence, and shows it. No data leaves the house computer except the finished answer (at most 64 KB).
-- Same shape as the place questions (20261104000300_geo_requests.sql): the table is closed to EVERY API role (only the token-checked connect_county_* functions and the worker's three functions touch it); the same question within 10 minutes is one request; at most 5 open at
-- once and 100 a day per person (the connector adds its own 30 an hour); kept 7 days (every ask and every read purges); a waiting-list account is refused by the same gate as everything else (gate_apply at the end covers the worker functions).
-- The database knows only the SHAPE of a request (5-digit codes, one kind, three rules, a year range); WHICH counties are offered is a closed list in the connector and in GEO's tool, so a new county needs no migration.
-- Needs 20261018000100_connect_ai.sql (connect_actor, connect_runner) and 20261104000100_waiting_accounts.sql. Undo: supabase/rollbacks/20261109000200_county_requests_rollback.sql.

begin;

create function ryagram_private.county_list_ok(p_counties text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_counties is not null and cardinality(p_counties) between 1 and 5
     and not exists (select 1 from unnest(p_counties) c where c is null or c !~ '^[0-9]{5}$')
     and (select count(distinct c) from unnest(p_counties) c) = cardinality(p_counties)
$$;

create table public.county_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  shape text not null check (shape in ('profile', 'compare')),
  counties text[] not null check (ryagram_private.county_list_ok(counties)),
  kind text not null default 'limited_service' check (kind = 'limited_service'),
  rule text check (rule is null or rule in ('per_10k_low_first', 'per_10k_high_first', 'count_high_first')),
  year int check (year is null or year between 1998 and 2024),
  state text not null default 'asked' check (state in ('asked', 'claimed', 'answered', 'failed')),
  answer jsonb check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 65536)),
  fail_code text check (fail_code is null or fail_code in ('request_rejected', 'county_not_held', 'engine_error', 'answer_rejected')),
  fail_detail text check (fail_detail is null or char_length(fail_detail) <= 300),
  asked_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  check ((shape = 'profile' and cardinality(counties) = 1 and rule is null and year is null) or (shape = 'compare' and cardinality(counties) >= 2 and (year is null or rule is not null)))
);
create index county_requests_owner on public.county_requests (owner_id, asked_at desc);
create index county_requests_open on public.county_requests (asked_at) where state in ('asked', 'claimed');
alter table public.county_requests enable row level security;
revoke all on public.county_requests from public, anon, authenticated, service_role, connect_runner;      -- no policy at all: no API role reads or writes the table directly

-- ---------------------------------------------------------------- the AI asks (token-checked; no function takes an owner)
create function public.connect_county_ask(p_token_hash text, p_shape text, p_counties text[], p_kind text, p_rule text, p_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  waiting int; today int; same public.county_requests; nid uuid;
begin
  delete from public.county_requests where asked_at < now() - interval '7 days';
  if p_shape is null or p_shape not in ('profile', 'compare') then
    raise exception 'Ask for a county profile or a comparison of counties.' using errcode = '22023';
  end if;
  if not ryagram_private.county_list_ok(p_counties) then
    raise exception 'Give one to five different counties, each as its 5-digit code (state and county), for example 39057.' using errcode = '22023';
  end if;
  if (p_shape = 'profile' and cardinality(p_counties) <> 1) or (p_shape = 'compare' and cardinality(p_counties) < 2) then
    raise exception 'A profile is for one county and a comparison is for two or more.' using errcode = '22023';
  end if;
  if p_kind is distinct from 'limited_service' then
    raise exception 'The only kind in version one is limited_service (limited-service restaurants).' using errcode = '22023';
  end if;
  if p_rule is not null and p_rule not in ('per_10k_low_first', 'per_10k_high_first', 'count_high_first') then
    raise exception 'That is not a rule this service knows; an order is never guessed.' using errcode = '22023';
  end if;
  if p_shape = 'profile' and (p_rule is not null or p_year is not null) then
    raise exception 'A profile takes no rule and no year.' using errcode = '22023';
  end if;
  if p_year is not null and (p_year not between 1998 and 2024 or p_rule is null) then
    raise exception 'A year is a 4-digit year from 1998 to 2024, and only with a rule.' using errcode = '22023';
  end if;
  select * into same from public.county_requests
    where owner_id = me and shape = p_shape and counties = p_counties and kind = p_kind and rule is not distinct from p_rule and year is not distinct from p_year
      and state <> 'failed' and asked_at > now() - interval '10 minutes'
    order by asked_at desc limit 1;
  if found then
    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                      -- asking the same thing again is one request, not two
  end if;
  select count(*) into waiting from public.county_requests where owner_id = me and state in ('asked', 'claimed');
  if waiting >= 5 then
    raise exception 'There are already 5 county questions waiting for an answer. Wait for those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.county_requests where owner_id = me and asked_at > now() - interval '24 hours';
  if today >= 100 then
    raise exception 'That is 100 county questions in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.county_requests (owner_id, shape, counties, kind, rule, year) values (me, p_shape, p_counties, p_kind, p_rule, p_year) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

-- The answer (or where the question stands). Another person's request looks absent. waited_s lets the tool say plainly when the house computer is not picking things up.
create function public.connect_county_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); c public.county_requests;
begin
  delete from public.county_requests where asked_at < now() - interval '7 days';
  select * into c from public.county_requests where id = p_id and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'state', c.state, 'shape', c.shape, 'counties', to_jsonb(c.counties), 'kind', c.kind, 'rule', c.rule, 'year', c.year, 'answer', c.answer,
                            'fail_code', c.fail_code, 'fail_detail', c.fail_detail, 'waited_s', floor(extract(epoch from (coalesce(c.finished_at, now()) - c.asked_at)))::int);
end $$;

revoke execute on function public.connect_county_ask(text, text, text[], text, text, int), public.connect_county_get(text, uuid) from public, anon, authenticated;
grant execute on function public.connect_county_ask(text, text, text[], text, text, int), public.connect_county_get(text, uuid) to connect_runner;

-- ---------------------------------------------------------------- the house worker (WORKER's county job; require_worker() is the gate, as for jobs)
create function public.claim_next_county() returns table (request_id uuid, shape text, counties text[], kind text, rule text, year int)
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; c public.county_requests;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select * into c from public.county_requests
    where (state = 'asked' or (state = 'claimed' and claimed_at < now() - interval '10 minutes')) and asked_at > now() - interval '7 days'
    order by asked_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.county_requests set state = 'claimed', claimed_at = now() where id = c.id;
  return query select c.id, c.shape, c.counties, c.kind, c.rule, c.year;
end $$;

-- The answer must carry the schema of ITS shape (a profile answer for a profile, a comparison answer for a comparison) and fit 64 KB; its content is checked again by the connector.
create function public.finish_county(p_id uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); c public.county_requests;
begin
  select * into c from public.county_requests where id = p_id and state = 'claimed' for update;
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or octet_length(p_answer::text) > 65536
     or p_answer ->> 'schema' is distinct from (case when c.shape = 'profile' then 'ryagram.geo-county-profile/0' else 'ryagram.geo-compare-counties/0' end) then
    raise exception 'That is not a county answer.' using errcode = '22023';
  end if;
  update public.county_requests set state = 'answered', answer = p_answer, finished_at = now(), fail_code = null, fail_detail = null where id = p_id;
end $$;

create function public.fail_county(p_id uuid, p_code text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  if p_code is null or p_code not in ('request_rejected', 'county_not_held', 'engine_error', 'answer_rejected') then
    raise exception 'Unknown failure code.' using errcode = '22023';
  end if;
  update public.county_requests set state = 'failed', fail_code = p_code, fail_detail = left(btrim(coalesce(p_detail, '')), 300), finished_at = now() where id = p_id and state = 'claimed';
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
end $$;

revoke execute on function public.claim_next_county(), public.finish_county(uuid, jsonb), public.fail_county(uuid, text, text) from public, anon;
grant execute on function public.claim_next_county(), public.finish_county(uuid, jsonb), public.fail_county(uuid, text, text) to authenticated;

-- the keep time, for the dashboard or a schedule (every ask and every read purges as well)
create function public.county_purge() returns int
language sql security definer set search_path = '' as $$ with d as (delete from public.county_requests where asked_at < now() - interval '7 days' returning 1) select count(*)::int from d $$;
revoke execute on function public.county_purge() from public, anon, authenticated;
grant execute on function public.county_purge() to service_role;

revoke execute on function ryagram_private.county_list_ok(text[]) from public, anon, authenticated;
select ryagram_private.gate_apply();                       -- the worker functions get the waiting-list check like every other function a signed-in account can run

commit;

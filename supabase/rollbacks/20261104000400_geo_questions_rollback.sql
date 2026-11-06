-- GEO QUESTION SHAPES: the exact undo of migrations/20261104000400_geo_questions.sql. NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every compare/verdict/where-to-go request (short-lived questions and answers, kept 7 days at most) and puts the three old functions back as 20261104000300 made them. The old shape's rows are untouched.
-- Turn WORKER's question step off first. Run the gate again at the end (it is in this file) so the restored functions get the waiting-list check back.
begin;
delete from public.geo_requests where shape <> 'within_minutes';
drop function if exists public.claim_next_geo_question();
drop function if exists public.connect_geo_ask_shape(text, text, double precision, double precision, double precision, double precision, text, text);

create or replace function public.connect_geo_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); g public.geo_requests;
begin
  delete from public.geo_requests where asked_at < now() - interval '7 days';
  select * into g from public.geo_requests where id = p_id and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', g.id, 'state', g.state, 'lat', g.lat, 'lon', g.lon, 'minutes', g.minutes, 'categories', to_jsonb(g.categories), 'answer', g.answer,
                            'fail_code', g.fail_code, 'fail_detail', g.fail_detail, 'waited_s', floor(extract(epoch from (coalesce(g.finished_at, now()) - g.asked_at)))::int);
end $$;

create or replace function public.claim_next_geo() returns table (request_id uuid, lat double precision, lon double precision, minutes int, categories text[])
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

create or replace function public.finish_geo(p_id uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or p_answer ->> 'schema' is distinct from 'ryagram.drive-estimate/0' or octet_length(p_answer::text) > 65536 then
    raise exception 'That is not a drive estimate.' using errcode = '22023';
  end if;
  update public.geo_requests set state = 'answered', answer = p_answer, finished_at = now(), fail_code = null, fail_detail = null where id = p_id and state = 'claimed';
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
end $$;

alter table public.geo_requests drop constraint geo_requests_shape_fields;
alter table public.geo_requests drop column town, drop column category, drop column lon_b, drop column lat_b, drop column shape;
alter table public.geo_requests alter column lat set not null, alter column lon set not null, alter column minutes set not null;
select ryagram_private.gate_apply();
commit;

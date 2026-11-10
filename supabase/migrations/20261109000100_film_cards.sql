-- FILM LOOK CARDS (CONNECT 2026-11-09; BACKLOG CONNECT-2, editor Step A; contract proposals\CONNECT-EDITOR-STEP-A-CONTRACT-1109.md). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Nothing happens until the connector's chat-editor
-- switch is on AND the house worker's film-card job is built and switched on (neither is).
-- The chat editor panel shows a film's REAL colours and one REAL still frame from a "look card": a small JSON the engine draws from the film's SAVED story. The connector cannot draw one (no engine in an Edge Function), so it
-- writes a REQUEST here; the house worker claims it, runs ENGINE's card emitter and writes back ONLY the card; the connector checks the card against the shared schema before the panel ever sees it.
-- The story is never typed by the caller: the request is for the project's CURRENT saved story, found by the database itself (its sha-256 is the version's own), so nobody can ask for a card of a story that is not theirs.
-- Same shape as the place questions (20261104000300_geo_requests.sql): the table is closed to EVERY API role (only the token-checked connect_film_card_* functions and the worker's three functions touch it); one live row per
-- (person, project, saved story), so asking twice is one request; at most 5 open at once and 100 a day per person (the connector adds its own 20 an hour); a request is kept 30 days after it finishes and 7 days if never answered,
-- and every ask and every read purges; a waiting-list account is refused by the same gate as everything else (gate_apply at the end covers the worker functions). A card holds no personal data beyond the film's own colours and a drawn
-- picture of the film the person made.
-- Needs 20261018000100_connect_ai.sql (connect_actor, connect_runner) and 20261104000100_waiting_accounts.sql. Undo: supabase/rollbacks/20261109000100_film_cards_rollback.sql.

begin;

create table public.film_card_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  story_sha256 text not null check (story_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'asked' check (state in ('asked', 'claimed', 'answered', 'failed')),
  answer jsonb check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 262144)),
  fail_code text check (fail_code is null or fail_code in ('story_not_found', 'view_not_supported', 'engine_error', 'card_rejected')),
  fail_detail text check (fail_detail is null or char_length(fail_detail) <= 300),
  asked_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create unique index film_card_requests_one_per_story on public.film_card_requests (owner_id, project_id, story_sha256);
create index film_card_requests_owner on public.film_card_requests (owner_id, project_id, asked_at desc);
create index film_card_requests_open on public.film_card_requests (asked_at) where state in ('asked', 'claimed');
alter table public.film_card_requests enable row level security;
revoke all on public.film_card_requests from public, anon, authenticated, service_role, connect_runner;      -- no policy at all: no API role reads or writes the table directly

-- the keep time (also run by every ask and every read): a request nobody answered goes after 7 days, a finished one after 30
create function ryagram_private.film_card_sweep() returns void
language sql security definer set search_path = '' as $$
  delete from public.film_card_requests where (state in ('asked', 'claimed') and asked_at < now() - interval '7 days') or (state in ('answered', 'failed') and finished_at < now() - interval '30 days')
$$;

-- ---------------------------------------------------------------- the panel asks (token-checked; no function takes an owner or a story)
create function public.connect_film_card_ask(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  v public.versions; same public.film_card_requests; waiting int; today int; nid uuid;
begin
  -- One ask at a time per person: two asks in flight together (an AI making parallel tool calls) would both count the same open requests and both insert, passing the 5-open and 100-a-day limits and storing the same film twice.
  -- The second waits here until the first has committed, then counts it. The lock is released at the end of the transaction; another person's ask is never held by it. (WORKER's finding for the county and place asks; the same lock there.)
  perform pg_advisory_xact_lock(hashtextextended('film_card:' || me::text, 0));
  perform ryagram_private.film_card_sweep();
  select ver.* into v from public.versions ver join public.projects p on p.id = ver.project_id
    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;
  if not found then
    raise exception 'That film was not found among your projects.' using errcode = '22023';
  end if;
  select * into same from public.film_card_requests where owner_id = me and project_id = p_project and story_sha256 = v.story_sha256;
  if found then
    -- a card that failed because the engine broke may be tried again after 10 minutes; any other answer for the same saved story stands
    if same.state = 'failed' and same.fail_code = 'engine_error' and same.finished_at < now() - interval '10 minutes' then
      delete from public.film_card_requests where id = same.id;
    else
      return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                    -- asking again for the same saved film is one request, not two
    end if;
  end if;
  select count(*) into waiting from public.film_card_requests where owner_id = me and state in ('asked', 'claimed');
  if waiting >= 5 then
    raise exception 'There are already 5 film pictures waiting to be drawn. Wait for those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.film_card_requests where owner_id = me and asked_at > now() - interval '24 hours';
  if today >= 100 then
    raise exception 'That is 100 film pictures in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256) values (me, p_project, v.id, v.story_sha256) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

-- The newest card for the film (stale if the film has been saved again since), or where the newest request for the CURRENT saved story stands. Another person's film looks absent (null).
create function public.connect_film_card_get(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  cur text; ok public.film_card_requests; r public.film_card_requests; retry boolean;
begin
  perform ryagram_private.film_card_sweep();
  select ver.story_sha256 into cur from public.versions ver join public.projects p on p.id = ver.project_id
    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;
  if not found then return null; end if;
  select * into ok from public.film_card_requests where owner_id = me and project_id = p_project and state = 'answered' order by (story_sha256 = cur) desc, finished_at desc limit 1;
  select * into r from public.film_card_requests where owner_id = me and project_id = p_project and story_sha256 = cur;
  -- the same rule the ask applies: only a card that failed because the engine broke may be asked for again, and only after 10 minutes; the connector asks again only when this says so
  retry := r.id is not null and r.state = 'failed' and r.fail_code = 'engine_error' and r.finished_at < now() - interval '10 minutes';
  if ok.id is not null then
    -- an older card is shown (stale) while a newer one is asked for; 'refresh' says where that request stands, so the panel asks once and the tool never asks twice
    return jsonb_build_object('state', 'ready', 'id', ok.id, 'card', ok.answer, 'built_sha256', ok.story_sha256, 'current_sha256', cur, 'stale', ok.story_sha256 <> cur,
                              'refresh', case when ok.story_sha256 = cur or r.id is null then null else jsonb_build_object('state', r.state, 'fail_code', r.fail_code, 'retry', retry) end,
                              'waited_s', floor(extract(epoch from (ok.finished_at - ok.asked_at)))::int);
  end if;
  if r.id is null then return jsonb_build_object('state', 'none', 'current_sha256', cur); end if;
  return jsonb_build_object('state', r.state, 'id', r.id, 'current_sha256', cur, 'fail_code', r.fail_code, 'fail_detail', r.fail_detail, 'retry', retry,
                            'waited_s', floor(extract(epoch from (coalesce(r.finished_at, now()) - r.asked_at)))::int);
end $$;

revoke execute on function public.connect_film_card_ask(text, uuid), public.connect_film_card_get(text, uuid) from public, anon, authenticated;
grant execute on function public.connect_film_card_ask(text, uuid), public.connect_film_card_get(text, uuid) to connect_runner;

-- ---------------------------------------------------------------- the house worker (WORKER's film-card job; require_worker() is the gate, as for jobs)
create function public.claim_next_film_card() returns table (request_id uuid, project_id uuid, version_id uuid, story_sha256 text, story jsonb, dataset_id uuid)
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.film_card_requests; v public.versions;
begin
  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  select * into g from public.film_card_requests
    where (state = 'asked' or (state = 'claimed' and claimed_at < now() - interval '10 minutes')) and asked_at > now() - interval '7 days'
    order by asked_at limit 1 for update skip locked;
  if not found then return; end if;
  select * into v from public.versions where id = g.version_id;          -- cannot be missing: the request goes with its version (on delete cascade)
  update public.film_card_requests set state = 'claimed', claimed_at = now() where id = g.id;
  return query select g.id, g.project_id, g.version_id, g.story_sha256, v.story_spec, v.dataset_id;
end $$;

-- The card must be an object, at most 262,144 bytes, schema 1, with a frame picture, and drawn from THIS request's saved story (the worker cannot store a card for another story). Its content is checked again by the connector from the shared schema.
create function public.finish_film_card(p_id uuid, p_card jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker(); g public.film_card_requests;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 262144 or p_card -> 'schema' is distinct from '1'::jsonb
     or jsonb_typeof(p_card -> 'look') is distinct from 'object' or jsonb_typeof(p_card #> '{frame,svg}') is distinct from 'string' then
    raise exception 'That is not a film look card.' using errcode = '22023';
  end if;
  select * into g from public.film_card_requests where id = p_id and state = 'claimed' for update;          -- the row is locked: a second finish, or a fail, for the same request waits here and then finds it no longer claimed
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
  if p_card #>> '{basis,story_sha256}' is distinct from g.story_sha256 then
    raise exception 'That card was not drawn from this request''s saved story.' using errcode = '22023';
  end if;
  update public.film_card_requests set state = 'answered', answer = p_card, finished_at = now(), fail_code = null, fail_detail = null where id = p_id;
end $$;

create function public.fail_film_card(p_id uuid, p_code text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  if p_code is null or p_code not in ('story_not_found', 'view_not_supported', 'engine_error', 'card_rejected') then
    raise exception 'Unknown failure code.' using errcode = '22023';
  end if;
  update public.film_card_requests set state = 'failed', fail_code = p_code, fail_detail = left(btrim(coalesce(p_detail, '')), 300), finished_at = now() where id = p_id and state = 'claimed';
  if not found then raise exception 'No such claimed request.' using errcode = 'PT404'; end if;
end $$;

revoke execute on function public.claim_next_film_card(), public.finish_film_card(uuid, jsonb), public.fail_film_card(uuid, text, text) from public, anon;
grant execute on function public.claim_next_film_card(), public.finish_film_card(uuid, jsonb), public.fail_film_card(uuid, text, text) to authenticated;

-- the keep time, for the dashboard or a schedule (every ask and every read purges as well)
create function public.film_card_purge() returns int
language sql security definer set search_path = '' as $$
  with d as (delete from public.film_card_requests where (state in ('asked', 'claimed') and asked_at < now() - interval '7 days') or (state in ('answered', 'failed') and finished_at < now() - interval '30 days') returning 1) select count(*)::int from d
$$;
revoke execute on function public.film_card_purge() from public, anon, authenticated;
grant execute on function public.film_card_purge() to service_role;

revoke execute on function ryagram_private.film_card_sweep() from public, anon, authenticated;
select ryagram_private.gate_apply();                       -- the worker functions get the waiting-list check like every other function a signed-in account can run

commit;

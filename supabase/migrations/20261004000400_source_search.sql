-- Prompt-first sourcing, path 1: AI source suggestions (the source-search Edge Function) and the data-gap queue.
-- NOT APPLIED. Design: Ryagram-logs/proposals/WEB-PROMPT-FIRST-SOURCING.md, section 2.
--
--   catalog_sources   gains the facts the matcher checks the model against (level, years, cadence, topic, measure,
--                     summary, derived). Rerun the regenerated supabase/catalog_sources_seed.sql AFTER this file.
--   source_searches   one row per search: who, when, outcome, tokens and cost. NO request text (that lives only in
--                     data_gaps, and only when the data can't support it).
--   data_gaps         the queue: what people asked for that Ryagram can't show. Request text capped at 500
--                     characters; kept 12 months; the person can read and delete their own; removed with the account.
--                     Ryan sees counts first (data_gaps_by_need) and the texts on demand (data_gap_requests).
--
-- The Edge Function verifies the person's sign-in itself and uses service_role ONLY for the functions below;
-- p_owner is always the id it verified, never request data. The Anthropic key lives only in the function's secrets.
-- Caps and the kill switch reuse the AI editor's: control.ai_enabled, plus control.source_search_per_day.

begin;

alter table public.catalog_sources
  add column level text check (level in ('state', 'county', 'other')),
  add column year_first int check (year_first between 1700 and 2200),
  add column year_last int check (year_last between 1700 and 2200),
  add column cadence text not null default '' check (char_length(cadence) <= 20),
  add column topic text not null default '' check (char_length(topic) <= 80),
  add column measure text not null default '' check (char_length(measure) <= 200),
  add column summary text not null default '' check (char_length(summary) <= 400),
  add column derived boolean not null default false;

alter table public.control add column source_search_per_day int not null default 30 check (source_search_per_day >= 0);

create table public.source_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  outcome text check (outcome in ('suggested', 'partial', 'no_match', 'not_runnable', 'error')),
  suggested int check (suggested between 0 and 20),
  recommended_id text check (char_length(recommended_id) <= 80),
  model text check (char_length(model) <= 80),
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  cache_read_input_tokens int check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens int check (cache_creation_input_tokens >= 0),
  latency_ms int check (latency_ms >= 0),
  price_version text,
  cost_usd numeric(12, 6),                                      -- NULL when a count or price is unknown
  error text check (char_length(error) <= 500)
);
create index source_searches_owner_time on public.source_searches (owner_id, created_at);
alter table public.source_searches enable row level security;
revoke all on public.source_searches from anon, authenticated, service_role;

create table public.data_gaps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  search_id uuid references public.source_searches (id) on delete set null,
  created_at timestamptz not null default now(),
  request_text text not null check (char_length(request_text) between 1 and 500),
  need jsonb not null check (jsonb_typeof(need) = 'object' and pg_column_size(need) <= 4096),
  reason text not null check (reason in ('no_such_data', 'geography_too_fine', 'years_outside_coverage', 'needs_private_data',
                                         'exists_not_runnable_yet', 'partly_supported')),
  need_key text not null check (need_key ~ '^[a-z0-9 _|.-]{1,200}$'),
  nearest_ids text[] not null default '{}' check (cardinality(nearest_ids) <= 6)
);
create index data_gaps_key on public.data_gaps (need_key, created_at);
create index data_gaps_owner on public.data_gaps (owner_id, created_at);
alter table public.data_gaps enable row level security;
revoke all on public.data_gaps from anon, authenticated, service_role;
grant select, delete on public.data_gaps to authenticated;
create policy "People read their own data requests" on public.data_gaps for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "People delete their own data requests" on public.data_gaps for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- the function's calls (service_role)

-- Starts a search: refuses worker accounts, a switched-off editor and a person over today's cap.
create function public.source_search_reserve(p_owner uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ctl public.control; sid uuid;
begin
  if exists (select 1 from public.workers where user_id = p_owner) then
    raise exception 'The worker account can''t use source search.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 44));
  select * into ctl from public.control where id;
  if not ctl.ai_enabled then
    raise exception 'Finding data is switched off.' using errcode = 'PT503';
  end if;
  if (select count(*) from public.source_searches
      where owner_id = p_owner and created_at > now() - interval '24 hours') >= ctl.source_search_per_day then
    raise exception 'You have reached today''s limit for finding data. It resets over the next 24 hours.' using errcode = 'PT429';
  end if;
  insert into public.source_searches (owner_id) values (p_owner) returning id into sid;
  return sid;
end $$;

-- Ends a search and records its usage, priced at the current price version (the AI editor's ai_prices).
create function public.source_search_finish(p_search uuid, p_status text, p_outcome text, p_suggested int,
                                            p_recommended text, p_usage jsonb) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  pr public.ai_prices;
  v_model text := p_usage->>'model';
  inp int := (p_usage->>'input_tokens')::int;
  outp int := (p_usage->>'output_tokens')::int;
  cr int := (p_usage->>'cache_read_input_tokens')::int;
  cw int := (p_usage->>'cache_creation_input_tokens')::int;
  cost numeric;
begin
  if p_status not in ('done', 'failed') then
    raise exception 'Bad status.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.source_searches where id = p_search and status = 'running') then
    raise exception 'Search not found.' using errcode = 'PT404';
  end if;
  select * into pr from public.ai_prices
    where ai_prices.model = v_model and effective_from <= now() order by effective_from desc limit 1;
  if pr.model is not null and inp is not null and outp is not null and cr is not null and cw is not null then
    cost := (inp * pr.input_per_mtok + outp * pr.output_per_mtok + cr * pr.cache_read_per_mtok
             + cw * pr.cache_write_5m_per_mtok) / 1000000.0;
  end if;
  update public.source_searches set status = p_status, ended_at = now(), outcome = p_outcome, suggested = p_suggested,
         recommended_id = p_recommended, model = v_model, input_tokens = inp, output_tokens = outp,
         cache_read_input_tokens = cr, cache_creation_input_tokens = cw, latency_ms = (p_usage->>'latency_ms')::int,
         price_version = pr.price_version, cost_usd = cost, error = left(p_usage->>'error', 500)
    where id = p_search;
  return cost;
end $$;

-- The internal catalog, for the function only. No other role can read catalog_sources.
create function public.source_search_catalog() returns setof public.catalog_sources
language sql stable security definer set search_path = '' as $$
  select * from public.catalog_sources order by id
$$;

-- Writes one request to the queue (and trims what is over 12 months old, so retention needs no schedule).
create function public.log_data_gap(p_owner uuid, p_search uuid, p_text text, p_need jsonb, p_reason text,
                                    p_key text, p_nearest text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.data_gaps where created_at < now() - interval '12 months';
  insert into public.data_gaps (owner_id, search_id, request_text, need, reason, need_key, nearest_ids)
    values (p_owner, p_search, left(trim(p_text), 500), coalesce(p_need, '{}'::jsonb), p_reason, p_key, coalesce(p_nearest, '{}'));
end $$;

-- ---------------------------------------------------------------- the person's own requests

create function public.delete_my_data_gaps() returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); n int;
begin
  delete from public.data_gaps where owner_id = me;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- Ryan's view (admins only): counts first, texts on demand

create function public.data_gaps_by_need(p_days int default 365)
returns table (need_key text, asks int, people int, last_at timestamptz, reason text, topic text, level text,
               years text, nearest_ids text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see the data requests.' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not between 1 and 3660 then
    raise exception 'Choose 1 to 3660 days.' using errcode = '22023';
  end if;
  return query
    select g.need_key, count(*)::int, count(distinct g.owner_id)::int, max(g.created_at),
           (array_agg(g.reason order by g.created_at desc))[1],
           (array_agg(left(coalesce(g.need->>'topic', ''), 80) order by g.created_at desc))[1],
           (array_agg(left(coalesce(g.need->>'level', ''), 20) order by g.created_at desc))[1],
           (array_agg(left(coalesce(g.need->>'year_first', '') || ' to ' || coalesce(g.need->>'year_last', ''), 20)
                      order by g.created_at desc))[1],
           (select g2.nearest_ids from public.data_gaps g2 where g2.need_key = g.need_key
            order by g2.created_at desc limit 1)
    from public.data_gaps g
    where g.created_at >= now() - make_interval(days => p_days)
    group by g.need_key
    order by 2 desc, 4 desc;
end $$;

create function public.data_gap_requests(p_need_key text, p_limit int default 50)
returns table (created_at timestamptz, request_text text, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see the data requests.' using errcode = '42501';
  end if;
  return query
    select g.created_at, g.request_text, g.reason from public.data_gaps g
    where g.need_key = p_need_key order by g.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke execute on function public.source_search_reserve(uuid), public.source_search_finish(uuid, text, text, int, text, jsonb),
  public.source_search_catalog(), public.log_data_gap(uuid, uuid, text, jsonb, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.source_search_reserve(uuid), public.source_search_finish(uuid, text, text, int, text, jsonb),
  public.source_search_catalog(), public.log_data_gap(uuid, uuid, text, jsonb, text, text, text[]) to service_role;
revoke execute on function public.delete_my_data_gaps(), public.data_gaps_by_need(int), public.data_gap_requests(text, int)
  from public, anon;
grant execute on function public.delete_my_data_gaps(), public.data_gaps_by_need(int), public.data_gap_requests(text, int)
  to authenticated;

commit;

-- Visit counting for uselai.com/ryagram/ (Ryan, 2026-10-06). NOT APPLIED. Needs 20261003000300 (app_admins) first.
--
-- A cookieless TALLY, nothing more: how many times /ryagram/ was loaded each day, and from which link source
-- (?ref=youtube, or failing that ?utm_source=). One row per (day, path, source) holding a number. No visitor id, no
-- cookie, no address, no user agent, no timestamp finer than the day: the table cannot say who anyone was, or even
-- that two visits were one person. (Cloudflare Web Analytics, set up separately, is the independent visit count;
-- this tally exists because Cloudflare does not break visits out by ?ref=.)
--
--   record_visit(path, source)   anyone (the public key) may call it; it only ever adds 1 to one row.
--                                Anything but '/ryagram/' is ignored; a source that is not [a-z0-9._-]{1,24} is
--                                counted as "no link"; after 50 different sources in one day the rest count as 'other',
--                                so a stranger cannot grow the table by inventing sources.
--   visits_by_day(days)          Ryan only (app_admins, like waitlist_by_film): per day, visits and signups.
--   visits_by_source(days)       Ryan only: per source, visits and signups.
--
-- Signups are read from the waitlist's existing `source` text ('uselai.com/ryagram?utm_source=youtube&ref=youtube'):
-- the source is ref, or failing that utm_source, lower-cased: the same rule the page applies to a visit. Days are New
-- York days (EST5EDT is New York's own rule set, and exists on every Postgres, including the test server).

begin;

create table public.ryagram_visits (
  day date not null,
  path text not null check (path = '/ryagram/'),
  source text not null default '' check (source ~ '^[a-z0-9._-]{0,24}$'),
  visits int not null default 0 check (visits >= 0),
  primary key (day, path, source)
);
alter table public.ryagram_visits enable row level security;
revoke all on table public.ryagram_visits from anon, authenticated, service_role;     -- no policy, no grant: only the functions below touch it

create function public.record_visit(p_path text, p_source text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'EST5EDT')::date;
  src text := lower(coalesce(p_source, ''));
begin
  if p_path is distinct from '/ryagram/' then
    return;                                                   -- not a page we count: ignore, say nothing
  end if;
  if src !~ '^[a-z0-9._-]{1,24}$' then
    src := '';
  end if;
  if src <> ''
     and not exists (select 1 from public.ryagram_visits v where v.day = d and v.path = p_path and v.source = src)
     and (select count(*) from public.ryagram_visits v where v.day = d and v.path = p_path and v.source <> '' and v.source <> 'other') >= 50 then
    src := 'other';
  end if;
  insert into public.ryagram_visits as v (day, path, source, visits) values (d, p_path, src, 1)
    on conflict (day, path, source) do update set visits = v.visits + 1;
end $$;

-- The signup's source, by the same rule as the page: ref, else utm_source, lower-cased, '' when neither.
create function ryagram_private.signup_source(p_source text) returns text
language sql immutable set search_path = '' as $$
  select left(lower(coalesce(substring(p_source from '[?&]ref=([A-Za-z0-9._-]+)'),
                             substring(p_source from '[?&]utm_source=([A-Za-z0-9._-]+)'), '')), 24)
$$;

create function public.visits_by_day(p_days int default 30)
returns table (day date, visits int, signups int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see visit counts.' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not between 1 and 3660 then
    raise exception 'Choose 1 to 3660 days.' using errcode = '22023';
  end if;
  return query
    with v as (
      select r.day, sum(r.visits)::int as n from public.ryagram_visits r
      where r.day >= (now() at time zone 'EST5EDT')::date - p_days group by r.day),
    s as (
      select (w.created_at at time zone 'EST5EDT')::date as day, count(*)::int as n from public.ryagram_waitlist w
      where w.created_at >= now() - make_interval(days => p_days) group by 1)
    select coalesce(v.day, s.day), coalesce(v.n, 0), coalesce(s.n, 0)
    from v full join s on s.day = v.day
    order by 1 desc;
end $$;

create function public.visits_by_source(p_days int default 30)
returns table (source text, visits int, signups int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see visit counts.' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not between 1 and 3660 then
    raise exception 'Choose 1 to 3660 days.' using errcode = '22023';
  end if;
  return query
    with v as (
      select r.source, sum(r.visits)::int as n from public.ryagram_visits r
      where r.day >= (now() at time zone 'EST5EDT')::date - p_days group by r.source),
    s as (
      select ryagram_private.signup_source(w.source) as source, count(*)::int as n from public.ryagram_waitlist w
      where w.created_at >= now() - make_interval(days => p_days) group by 1)
    select coalesce(v.source, s.source), coalesce(v.n, 0), coalesce(s.n, 0)
    from v full join s on s.source = v.source
    order by 2 desc, 3 desc, 1;
end $$;

revoke execute on function ryagram_private.signup_source(text) from public, anon, authenticated;
revoke execute on function public.record_visit(text, text), public.visits_by_day(int), public.visits_by_source(int) from public, anon;
grant execute on function public.record_visit(text, text) to anon, authenticated;
grant execute on function public.visits_by_day(int), public.visits_by_source(int) to authenticated;     -- is_app_admin() is the gate

commit;

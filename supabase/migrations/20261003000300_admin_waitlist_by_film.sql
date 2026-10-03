-- "Waitlist by film": signup counts per film link (utm_campaign), by day, for Ryan only.
-- NOT APPLIED.
--
-- The waitlist stays insert-only for everyone (ryagram-waitlist.sql): no role gets SELECT on it.
-- The one new read path is waitlist_by_film(), a security-definer function that returns COUNTS
-- (day, campaign, utm_source, signups) and nothing else -- no email, no use_case -- and only to
-- an account listed in app_admins. Everyone else, signed in or not, gets 42501 (permission denied).
--
-- app_admins is seeded with ryan.galen@uselai.com's account below, by email at apply time (no
-- user id in this public repo). Nobody can add themselves: no role may write or read the table.
-- To add or remove an admin later, in the SQL Editor:
--   insert into public.app_admins (user_id, note) select id, 'why' from auth.users where email = '...';
--   delete from public.app_admins where user_id = (select id from auth.users where email = '...');

begin;

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated, service_role;

insert into public.app_admins (user_id, note)
  select id, 'Ryan (seeded by 20261003000300)' from auth.users where lower(email) = 'ryan.galen@uselai.com'
  on conflict (user_id) do nothing;

create function ryagram_private.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()))
$$;

-- For the app: am I an admin? Says nothing about anyone else.
create function public.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select ryagram_private.is_app_admin()
$$;

-- Signups per day (in p_tz) and per film link over the last p_days days. The campaign and
-- source are read from the `source` column the signup form writes
-- ('uselai.com/ryagram?utm_source=youtube&utm_campaign=r002-industry-story'); a signup with no
-- campaign is reported as campaign null.
create function public.waitlist_by_film(p_days int default 90, p_tz text default 'America/New_York')
returns table (day date, campaign text, utm_source text, signups int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see the waitlist counts.' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not between 1 and 3660 then
    raise exception 'Choose 1 to 3660 days.' using errcode = '22023';
  end if;
  begin
    perform now() at time zone p_tz;                 -- a zone Postgres can't convert to is refused
  exception when others then
    raise exception 'Unknown time zone.' using errcode = '22023';
  end;
  return query
    select (w.created_at at time zone p_tz)::date,
           substring(w.source from 'utm_campaign=([A-Za-z0-9._-]+)'),
           substring(w.source from 'utm_source=([A-Za-z0-9._-]+)'),
           count(*)::int
    from public.ryagram_waitlist w
    where w.created_at >= now() - make_interval(days => p_days)
    group by 1, 2, 3
    order by 1 desc, 4 desc, 2 nulls last;
end $$;

revoke execute on function ryagram_private.is_app_admin() from public, anon, authenticated;
revoke execute on function public.is_app_admin(), public.waitlist_by_film(int, text) from public, anon;
grant execute on function public.is_app_admin(), public.waitlist_by_film(int, text) to authenticated;

commit;

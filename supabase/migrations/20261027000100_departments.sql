-- DEPARTMENTS IN THE TOP BAR, THE SERVER HALF (NEXT-WEB 147 piece 2; Ryan 2026-10-26 17:52: not-built departments are shown as 'Coming soon' with a 'Tell me when it's ready' button).
-- NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes. The page (assets/app-departments.js, behind the `departments` flag, off) already calls these functions.
--
--   departments            the list Ryan owns: id, label, status ('working' | 'soon'), whether it needs the account's local-compute (tester) flag, the order. Seeded below: data_films WORKING; compilations,
--                          geo_intelligence, games, animation_studio SOON. Ryan promotes a department with one UPDATE from the SQL editor; no page change for the bar.
--   department_interest    'Tell me when it's ready': ONE row per person per department, and ONLY these three facts: owner_id, department, created_at. No email address, no device or browser detail, no text.
--                          NOTHING in this file sends anything: no email, no trigger, no queue, no webhook, no pg_net, no cron.
--   my_departments()                       the signed-in, INVITED account's list [{id, label, status}] in the page's order (an account that is not invited, a worker, an admin or nobody gets []).
--                                          A 'working' department that needs local-compute is returned as 'soon' for an account without that flag (compilations, once Ryan promotes it).
--   my_department_interests()              the person's own rows [{department}].
--   register_department_interest(dept)     idempotent; only for a department this account sees as 'soon'.
--   withdraw_department_interest(dept)     deletes the person's own row ('Take it back'); deleting the account deletes all of them (on delete cascade).
--   admin_department_interest_counts()     Ryan only (app_admins): [{department, people}], numbers per department, NO names.
-- Invited = the same rule as 'may this account connect an AI' (ryagram_private.connect_person_ok: enabled in connect_access, not an admin, not a worker): the page asks connectAccess() first, and so does the server.
-- Undo: supabase/rollbacks/20261027000100_departments_rollback.sql.

begin;

create table public.departments (
  id text primary key check (id ~ '^[a-z][a-z_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 60),
  status text not null default 'soon' check (status in ('working', 'soon')),
  needs_local_compute boolean not null default false,
  sort integer not null default 100);

insert into public.departments (id, label, status, needs_local_compute, sort) values
  ('data_films', 'Data films', 'working', false, 10),
  ('compilations', 'Compilations', 'soon', true, 20),
  ('geo_intelligence', 'Geographic Intelligence', 'soon', false, 30),
  ('games', 'Games', 'soon', false, 40),
  ('animation_studio', 'Animation Studio', 'soon', false, 50);

create table public.department_interest (
  owner_id uuid not null references auth.users (id) on delete cascade,
  department text not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, department));

alter table public.departments enable row level security;
alter table public.department_interest enable row level security;
revoke all on public.departments, public.department_interest from public, anon, authenticated, service_role;       -- read and written only through the functions below

-- 'Invited' without a hard dependency on the CONNECT migration: this helper is plpgsql, so connect_person_ok is looked up only when it RUNS (a database without the connect migration, which
-- tests/test_connect.py builds to prove its prerequisite check, can still apply this file). Departments need connections anyway, so there it simply never answers true.
create function ryagram_private.department_person_ok(p_owner uuid) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return p_owner is not null and ryagram_private.connect_person_ok(p_owner);
end $$;
revoke all on function ryagram_private.department_person_ok(uuid) from public, anon, authenticated;

-- What this account sees: the table's rows, with a 'working' department that needs local-compute shown as 'soon' to an account without it.
create function ryagram_private.departments_for(p_owner uuid) returns table (id text, label text, status text, sort integer)
language sql stable set search_path = '' as $$
  select d.id, d.label,
         case when d.status = 'working' and d.needs_local_compute
                   and not coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_owner), false) then 'soon' else d.status end,
         d.sort
    from public.departments d
   where ryagram_private.department_person_ok(p_owner)
$$;
revoke all on function ryagram_private.departments_for(uuid) from public, anon, authenticated;

create function public.my_departments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'status', x.status) order by x.sort, x.id), '[]'::jsonb)
    from ryagram_private.departments_for(auth.uid()) x
$$;

create function public.my_department_interests() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('department', i.department) order by i.created_at, i.department), '[]'::jsonb)
    from public.department_interest i
   where auth.uid() is not null and i.owner_id = auth.uid() and ryagram_private.department_person_ok(auth.uid())
$$;

create function public.register_department_interest(p_department text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  if not ryagram_private.department_person_ok(me) then raise exception 'This is for invited accounts for now.' using errcode = 'PT403'; end if;
  if not exists (select 1 from ryagram_private.departments_for(me) x where x.id = p_department and x.status = 'soon') then
    raise exception 'That is not announced yet.' using errcode = 'PT404';
  end if;
  insert into public.department_interest (owner_id, department) values (me, p_department) on conflict (owner_id, department) do nothing;
end $$;

create function public.withdraw_department_interest(p_department text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  delete from public.department_interest where owner_id = me and department = p_department;
end $$;

create function public.admin_department_interest_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins a where a.user_id = auth.uid()) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('department', d.id, 'people', (select count(*) from public.department_interest i where i.department = d.id)) order by d.sort, d.id), '[]'::jsonb)
            from public.departments d);
end $$;

revoke all on function public.my_departments(), public.my_department_interests(), public.register_department_interest(text), public.withdraw_department_interest(text),
  public.admin_department_interest_counts() from public, anon;
grant execute on function public.my_departments(), public.my_department_interests(), public.register_department_interest(text), public.withdraw_department_interest(text),
  public.admin_department_interest_counts() to authenticated;

commit;

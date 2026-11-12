-- THE PER-ACCOUNT SWITCH LIST, DATABASE HALF (CONNECT 2026-11-10; Q576, Ryan's yes in CC1's 19:04 post). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- Today a website switch in assets/ryagram-config.js is on for everyone or for no one. Ryan wants to test an OFF feature on his own test accounts only. This adds ONE list per account, empty for everybody:
--   * account_settings.switches_on: the names of the website switches that are ON for THIS account (a name looks like aiFirst: a lower-case letter, then letters and digits, 2 to 40 characters; at most 20 a person).
--     Nobody can write it but the admin function below: the table's column grants name upload_retention only, so a person can neither insert nor update this column (the same arrangement as local_compute).
--   * admin_account_switch_set(email, switch, on, reason): an admin from the app only (an admin connected through an AI is refused), by EMAIL and switch name, a reason of 3 to 300 characters, no worker account,
--     every change an audit row; it returns that account's list after the change.
--   * admin_account_switch_list(), admin_account_switch_audit(): who has what on right now; the history, newest first (the audit table itself stays closed to every API role).
--   * my_switches(): the signed-in person reads THEIR OWN list and nobody else's. It FAILS CLOSED: an account with no row, no account at all, or an error all mean "nothing is on"; it never returns more than the stored list.
-- Nothing reads the list yet: WEB's page helper featureOn(name) does (a switch exactly 'account' is on only when my_switches() names it). With every list empty, applying this changes nothing anyone can see.
-- Apply AFTER: 20260929000900_account_basics.sql (account_settings), 20261017000600_pipe1_orders.sql (require_admin), 20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
-- Undo: supabase/rollbacks/20261110000400_account_switches_rollback.sql (the lists and the history are lost; nothing else).

begin;

alter table public.account_settings add column switches_on text[] not null default '{}';
-- 0 to 20 plain names, no empty slot, no quote, no space (the text form of the list is tested whole, so one pattern says all of it)
alter table public.account_settings add constraint account_settings_switches_on_names
  check (switches_on::text ~ '^\{([a-z][A-Za-z0-9]{1,39}(,[a-z][A-Za-z0-9]{1,39}){0,19})?\}$');

create table public.account_switch_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  switch text not null check (switch ~ '^[a-z][A-Za-z0-9]{1,39}$'),
  was_on boolean not null,
  turned_on boolean not null,
  set_by uuid not null references auth.users (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  at timestamptz not null default now());
alter table public.account_switch_audit enable row level security;
revoke all on public.account_switch_audit from public, anon, authenticated, service_role;

-- the one writer
create function public.admin_account_switch_set(p_email text, p_switch text, p_on boolean, p_reason text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();           -- an admin acts from the app, never through a connected AI
        target uuid; sw text := btrim(coalesce(p_switch, '')); old text[]; new text[];
begin
  if p_on is null then
    raise exception 'Say whether the switch is on or off.' using errcode = '22023';
  end if;
  if sw !~ '^[a-z][A-Za-z0-9]{1,39}$' then
    raise exception 'A switch name is a lower-case letter then letters and digits, like aiFirst.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'Say why, in a few words.' using errcode = '22023';
  end if;
  select id into target from auth.users where lower(email) = lower(btrim(p_email));
  if target is null then raise exception 'No account with that email.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.workers where user_id = target) then
    raise exception 'A worker account is not a person and cannot be a tester.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account_switch:' || target::text, 0));      -- two changes to one account never overwrite each other
  old := coalesce((select s.switches_on from public.account_settings s where s.owner_id = target), '{}');
  if p_on then
    new := coalesce((select array_agg(x order by x) from (select distinct unnest(old || sw) as x) u), '{}');
  else
    new := array_remove(old, sw);
  end if;
  if cardinality(new) > 20 then
    raise exception 'At most 20 switches can be on for one account.' using errcode = '22023';
  end if;
  insert into public.account_settings (owner_id, switches_on) values (target, new)
    on conflict (owner_id) do update set switches_on = excluded.switches_on;
  insert into public.account_switch_audit (user_id, switch, was_on, turned_on, set_by, reason)
    values (target, sw, sw = any (old), p_on, me, btrim(p_reason));
  return new;
end $$;

create function public.admin_account_switch_list() returns table (user_email text, switches text[])
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select u.email::text, s.switches_on from public.account_settings s join auth.users u on u.id = s.owner_id
               where cardinality(s.switches_on) > 0 order by lower(u.email);
end $$;

create function public.admin_account_switch_audit() returns table (user_email text, switch text, was_on boolean, turned_on boolean, set_by_email text, reason text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select (select u.email from auth.users u where u.id = a.user_id)::text, a.switch, a.was_on, a.turned_on,
                      (select u.email from auth.users u where u.id = a.set_by)::text, a.reason, a.at
               from public.account_switch_audit a order by a.at desc, a.id desc;
end $$;

-- a person reads their OWN list; no row, no account, or any problem means an empty list
create function public.my_switches() returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return '{}'; end if;
  return coalesce((select s.switches_on from public.account_settings s where s.owner_id = me), '{}');
end $$;

revoke all on function public.admin_account_switch_set(text, text, boolean, text), public.admin_account_switch_list(), public.admin_account_switch_audit(), public.my_switches() from public, anon, authenticated;
grant execute on function public.admin_account_switch_set(text, text, boolean, text), public.admin_account_switch_list(), public.admin_account_switch_audit(), public.my_switches() to authenticated;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list: the gate covers what a signed-in account can run

commit;

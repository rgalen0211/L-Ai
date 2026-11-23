-- SIGN-UP OPEN AT LAUNCH (CONNECT, 2026-11-21; CC1's 12:4x order, WEB's proposals/WEB-SIGNUP-FLIP-1121.md option 2): a stranger can make an account through the join function and be let in at once, with no invite and no one's approval.
-- NOT APPLIED: Ryan applies it. Apply AFTER 20261104000100, 20261104000200 and 20261106000100 (it replaces the 20261106000100 version of join_reserve). Rollback: supabase/rollbacks/20261121000800_join_open_rollback.sql. Check: supabase/live-steps/46_join_open_check.sql.
--
-- WHY: today join_reserve answers 'off' unless the waiting switch (ops_settings.waiting_accounts) is ON, and while it is ON every new account is recorded WAITING. So there was no setting where a stranger joins AND is let in.
-- WHAT THIS ADDS: one flag, ops_settings.join_open, OFF by default. join_reserve answers 'off' only when the waiting switch is off AND join_open is off. Nothing else changes: the same address check, the same limits (5 an hour and 10 a day per caller,
-- 3 a day per email, 200 a day overall), the same lock, the same answers. The account is recorded by the trigger that already exists: with the waiting switch OFF it is ACTIVE, with the switch ON (the brake, live-step 20) it is WAITING.
-- So after launch: join_open ON + waiting switch OFF = a stranger joins and is in; the brake (live-step 20) = new sign-ups wait instead; live-step 21 puts it back. join_open OFF + switch OFF = join closed, as today.
-- The migration turns NOTHING on: join_open is false after it. Ryan flips it with live-step 47 (and back with 48). Only the dashboard (the table owner) can write the flag: ops_settings is closed to every API role.
-- join_reserve keeps its name, arguments, owner and grants (service role only; create or replace keeps them).
--
-- ALSO IN THIS FILE (CC1's 13:5x order; Ryan's 11:30 'Age 18+'): the 18+ confirmation is RECORDED WITH THE ACCOUNT. The join function now refuses without adult_confirmed: true and passes it on as the new account's user metadata;
-- the trigger below copies it into public.account_adult_confirmation (user, time, source) in the same moment the account row is made, so a later change of the metadata cannot change the record. Closed to every API role (the
-- dashboard reads it); no policy, so the account gate has nothing to cover. If the recording ever failed, the account is still made (a warning is logged): a sign-up never fails because of this record.
-- Accounts made through join (source 'join') and through an invite code (redeem-invite, source 'invite') carry it; accounts made before this have no row. The source comes from the server-set metadata adult_source.

begin;

create table public.account_adult_confirmation (
  user_id uuid primary key references auth.users (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  source text not null check (source in ('join', 'invite'))
);
alter table public.account_adult_confirmation enable row level security;
revoke all on public.account_adult_confirmation from public, anon, authenticated, service_role;

create function ryagram_private.account_adult_new() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.raw_user_meta_data ->> 'adult_confirmed' = 'true' then
      insert into public.account_adult_confirmation (user_id, source) values (new.id, case when new.raw_user_meta_data ->> 'adult_source' = 'invite' then 'invite' else 'join' end) on conflict (user_id) do nothing;
    end if;
  exception when others then
    raise warning 'account_adult_confirmation not recorded: %', sqlstate;        -- never stops a sign-up (the whole check is inside: even a missing column cannot)
  end;
  return new;
end $$;
revoke execute on function ryagram_private.account_adult_new() from public, anon, authenticated, service_role;
create trigger account_adult_new_trg after insert on auth.users for each row execute function ryagram_private.account_adult_new();

alter table public.ops_settings add column join_open boolean not null default false;        -- Ryan's flag: a stranger who joins is let in (with the waiting switch off); false = join is closed unless the waiting list is on

create or replace function public.join_reserve(p_email text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mail text := lower(btrim(coalesce(p_email, ''))); eh text;
begin
  if not ryagram_private.waiting_on() and not coalesce((select o.join_open from public.ops_settings o limit 1), false) then       -- 'off' only when BOTH the waiting list and open sign-up are off
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if mail !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' or char_length(mail) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  eh := encode(sha256(convert_to('ryagram-join:' || mail, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- count-then-write takes turns, so callers at the same moment cannot pass the limit together
  delete from public.join_attempts where at < now() - interval '2 days';
  if (select count(*) from public.join_attempts where ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.join_attempts where ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and at > now() - interval '1 day') >= 10
     or (select count(*) from public.join_attempts where email_hash = eh and at > now() - interval '1 day') >= 3
     or (select count(*) from public.join_attempts where at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  insert into public.join_attempts (ip_hash, email_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64), eh);
  return jsonb_build_object('ok', true);
end $$;

-- 11-23 (CC1's audit of the email path): when the join function cannot send the email (SMTP down, Auth's hourly email allowance used up) it tells the person so and calls join_release, which gives back the ONE try
-- join_reserve just counted for this caller and address (the newest, within the last 10 minutes). Otherwise three honest retries on a launch morning would lock a stranger out for the day. Service role only, like join_reserve.
create function public.join_release(p_email text, p_ip_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare eh text := encode(sha256(convert_to('ryagram-join:' || lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- takes turns with join_reserve
  delete from public.join_attempts where ctid = (select a.ctid from public.join_attempts a
    where a.ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and a.email_hash = eh and a.at > now() - interval '10 minutes' order by a.at desc limit 1);
end $$;
revoke execute on function public.join_release(text, text) from public, anon, authenticated;
grant execute on function public.join_release(text, text) to service_role;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

-- "First time here? Create an account" without an invite code (Option B, path A of RYAN-QUEUE Q378): the join Edge Function asks join_reserve whether this caller may make
-- an account now, then has Supabase Auth send the invite email (the email link proves the address; the person sets the password on that first visit, as testers do).
-- NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Apply AFTER 20261104000100_waiting_accounts.sql. If Ryan chooses path B (open Auth sign-up) this file is not needed.
--
-- It does nothing until the switch is on: with ops_settings.waiting_accounts = false join_reserve answers 'off' and the function makes no account (otherwise a join would make a
-- FULL account, because while the switch is off every new account is recorded active).
-- Limits (one hour / one day windows, all joins counted, not just failures): 5 an hour per caller address, 3 a day per email address, 200 a day overall.
-- Only a SHA-256 of the caller's address and of the email is kept, for two days.

begin;

create table public.join_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) <= 64),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);
create index join_attempts_recent on public.join_attempts (at);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from public, anon, authenticated, service_role;

create function public.join_reserve(p_email text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mail text := lower(btrim(coalesce(p_email, ''))); eh text;
begin
  if not ryagram_private.waiting_on() then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if mail !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' or char_length(mail) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  eh := encode(sha256(convert_to('ryagram-join:' || mail, 'UTF8')), 'hex');
  delete from public.join_attempts where at < now() - interval '2 days';
  if (select count(*) from public.join_attempts where ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.join_attempts where email_hash = eh and at > now() - interval '1 day') >= 3
     or (select count(*) from public.join_attempts where at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  insert into public.join_attempts (ip_hash, email_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64), eh);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.join_reserve(text, text) from public, anon, authenticated;
grant execute on function public.join_reserve(text, text) to service_role;

commit;

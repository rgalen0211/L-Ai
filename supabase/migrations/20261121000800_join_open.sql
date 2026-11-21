-- SIGN-UP OPEN AT LAUNCH (CONNECT, 2026-11-21; CC1's 12:4x order, WEB's proposals/WEB-SIGNUP-FLIP-1121.md option 2): a stranger can make an account through the join function and be let in at once, with no invite and no one's approval.
-- NOT APPLIED: Ryan applies it. Apply AFTER 20261104000100, 20261104000200 and 20261106000100 (it replaces the 20261106000100 version of join_reserve). Rollback: supabase/rollbacks/20261121000800_join_open_rollback.sql. Check: supabase/live-steps/46_join_open_check.sql.
--
-- WHY: today join_reserve answers 'off' unless the waiting switch (ops_settings.waiting_accounts) is ON, and while it is ON every new account is recorded WAITING. So there was no setting where a stranger joins AND is let in.
-- WHAT THIS ADDS: one flag, ops_settings.join_open, OFF by default. join_reserve answers 'off' only when the waiting switch is off AND join_open is off. Nothing else changes: the same address check, the same limits (5 an hour and 10 a day per caller,
-- 3 a day per email, 200 a day overall), the same lock, the same answers. The account is recorded by the trigger that already exists: with the waiting switch OFF it is ACTIVE, with the switch ON (the brake, live-step 20) it is WAITING.
-- So after launch: join_open ON + waiting switch OFF = a stranger joins and is in; the brake (live-step 20) = new sign-ups wait instead; live-step 21 puts it back. join_open OFF + switch OFF = join closed, as today.
-- The migration turns NOTHING on: join_open is false after it. Ryan flips it with live-step 47 (and back with 48). Only the dashboard (the table owner) can write the flag: ops_settings is closed to every API role.
-- join_reserve keeps its name, arguments, owner and grants (service role only; create or replace keeps them).

begin;

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

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

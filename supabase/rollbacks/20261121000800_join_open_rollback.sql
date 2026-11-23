-- SIGN-UP OPEN AT LAUNCH: the exact undo of migrations/20261121000800_join_open.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts public.join_reserve back exactly as 20261106000100_waiting_gate_hardening.sql defined it (answers 'off' whenever the waiting switch is off) and drops the flag, the 18+ record table, its trigger and its function. Accounts that joined while it was open stay as they are (ACTIVE); nobody is removed.
-- The flag's value is lost with the column. Ends with gate_apply, like the migration.
begin;

create or replace function public.join_reserve(p_email text, p_ip_hash text) returns jsonb
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

drop function public.join_release(text, text);
alter table public.ops_settings drop column join_open;
drop trigger account_adult_new_trg on auth.users;
drop function ryagram_private.account_adult_new();
drop table public.account_adult_confirmation;        -- the recorded 18+ confirmations are lost with it: copy them out first (select * from public.account_adult_confirmation) if they should be kept

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

-- WAITING GATE HARDENING (CONNECT sweep, 2026-11-06; Claude's 02:24 night note). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Apply AFTER 20261104000100 and 20261104000200 (both are on main).
-- A fresh-eyes read of the gate SQL found three real weaknesses. None needs the switch to be on to be there, none was reachable by a signed-in person (all four functions are private or service-role only), and no live
-- data is touched. This file replaces four function bodies (same signatures, same grants, same callers) and nothing else; rollback: supabase/rollbacks/20261106000100_waiting_gate_hardening_rollback.sql.
--
-- 1. A PAID GRANT COULD BE STRANDED. activate_account (an approval) pays whatever sits in held_grants; hold_grant (a grant for a still-waiting account) files a grant there. They did not take turns: a grant that
--    arrived while an approval was open (account still WAITING in the grant's snapshot) was filed AFTER the approval had read held_grants, then the approval committed: a held grant for an ACTIVE account that nothing
--    would ever pay (a customer's month, or a welcome gift, lost). Now both take the same per-account lock for the length of their transaction, and hold_grant looks again after it has the lock.
-- 2. THE JOIN LIMITS COULD BE EXCEEDED BY CALLERS AT THE SAME MOMENT. join_reserve counts, then writes; two calls at once both counted four and both wrote the fifth. Now calls take turns (one lock, held to the
--    end of the transaction; the work inside is a few counts and one insert).
-- 3. INVITE GUESSING HAD A HOLE FOR A CALL WITH NO ADDRESS. invite_claim counted a caller's recent tries with `ip_hash = p_ip_hash`; with p_ip_hash null that is never true, so the per-caller limit never bit (only the
--    overall 300 an hour did) while the tries were still written as 'unknown'. Now the same 'unknown' is used to count as to write (as join_reserve already did), and the count-then-write takes turns like the join.
--
-- The three functions that take the per-account lock (hold_grant, activate_account, invite_claim) all take it FIRST, before any row lock, so they cannot deadlock one another.
-- Nothing here changes who may call what, what an answer says, or any limit's size.

begin;

-- 1a. the hold: take the account's lock, then look again
create or replace function ryagram_private.hold_grant(p_owner uuid, p_entry text, p_credits int, p_reason text, p_by text, p_event text, p_period text, p_price text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-account:' || coalesce(p_owner::text, ''), 0));      -- takes turns with activate_account for this account
  if ryagram_private.account_active(p_owner) then return false; end if;
  insert into public.held_grants (owner_id, entry, credits, reason, created_by, stripe_event_id, period_key, price_code)
    values (p_owner, p_entry, p_credits, left(p_reason, 300), left(p_by, 100), p_event, p_period, p_price) on conflict do nothing;
  return true;
end $$;

-- 1b. the approval: the same lock first
create or replace function ryagram_private.activate_account(p_user uuid, p_source text, p_by uuid, p_credits int, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare was text; n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-account:' || coalesce(p_user::text, ''), 0));       -- takes turns with hold_grant for this account
  select s.status into was from public.account_status s where s.user_id = p_user for update;
  if was = 'active' then return false; end if;
  insert into public.account_status (user_id, status, source, approved_by) values (p_user, 'active', p_source, p_by)
    on conflict (user_id) do update set status = 'active', source = excluded.source, approved_by = excluded.approved_by, since = now();
  insert into public.account_status_audit (user_id, from_status, to_status, source, by_user, reason) values (p_user, was, 'active', p_source, p_by, left(p_note, 300));
  declare h record;
  begin
    for h in select * from public.held_grants where owner_id = p_user order by id loop                     -- whatever was paid or granted while waiting is paid now, once
      perform public.grant_credits(h.owner_id, h.entry::public.credit_entry, h.credits, h.reason, h.created_by, h.stripe_event_id, h.period_key, h.price_code);
      delete from public.held_grants where id = h.id;
    end loop;
  end;
  if coalesce(p_credits, 0) > 0 then
    if to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is null then
      raise exception 'The credits ledger is not applied yet, so welcome credits cannot be granted.' using errcode = '55000';
    end if;
    perform public.grant_credits(p_user, 'grant', p_credits, 'Welcome credits (' || p_source || ')', p_source || ':' || p_user::text);
  end if;
  return true;
end $$;

-- 2. the join: calls take turns
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

-- 3. the invite claim: one name for a missing address when counting and when writing, and the count-then-write takes turns
create or replace function public.invite_claim(p_user uuid, p_code text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.invite_codes; mail text; flipped boolean; ip text := left(coalesce(p_ip_hash, 'unknown'), 64);
begin
  select u.email into mail from auth.users u where u.id = p_user;
  if mail is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ryagram-account:' || coalesce(p_user::text, ''), 0));       -- the SAME order as activate_account and hold_grant (this lock, then the row): the other order could deadlock
  perform 1 from public.account_status s where s.user_id = p_user for update;                   -- two codes claimed at once take turns: the second sees an active account
  if exists (select 1 from public.account_status s where s.user_id = p_user and s.status = 'active') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ryagram-invite-claim', 0));                    -- the guess count and the guess record take turns
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts where ip_hash = ip and at > now() - interval '1 hour') >= 10
     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;
  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses
     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then
    insert into public.invite_attempts (ip_hash) values (ip);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;
  insert into public.invite_redemptions (code_hash, email, user_id, status) values (c.code_hash, lower(btrim(mail)), p_user, 'sent');
  flipped := ryagram_private.activate_account(p_user, 'code', null, c.grant_credits, 'code:' || c.label);
  return jsonb_build_object('ok', true, 'activated', flipped);
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

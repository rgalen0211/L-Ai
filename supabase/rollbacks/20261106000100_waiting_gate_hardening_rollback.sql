-- WAITING GATE HARDENING: the exact undo of migrations/20261106000100_waiting_gate_hardening.sql (CONNECT, 2026-11-06). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It puts the five function bodies back as 20261104000100 / 20261104000200 wrote them (same signatures; grants are kept by create or replace). It changes no data.
begin;

-- hold_grant (20261104000100)
create or replace function ryagram_private.hold_grant(p_owner uuid, p_entry text, p_credits int, p_reason text, p_by text, p_event text, p_period text, p_price text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if ryagram_private.account_active(p_owner) then return false; end if;
  insert into public.held_grants (owner_id, entry, credits, reason, created_by, stripe_event_id, period_key, price_code)
    values (p_owner, p_entry, p_credits, left(p_reason, 300), left(p_by, 100), p_event, p_period, p_price) on conflict do nothing;
  return true;
end $$;

-- activate_account (20261104000100)
create or replace function ryagram_private.activate_account(p_user uuid, p_source text, p_by uuid, p_credits int, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare was text; n int;
begin
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

-- join_reserve (20261104000200)
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

-- invite_claim (20261104000100)
create or replace function public.invite_claim(p_user uuid, p_code text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.invite_codes; mail text; flipped boolean;
begin
  select u.email into mail from auth.users u where u.id = p_user;
  if mail is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform 1 from public.account_status s where s.user_id = p_user for update;                   -- two codes claimed at once take turns: the second sees an active account
  if exists (select 1 from public.account_status s where s.user_id = p_user and s.status = 'active') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10
     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;
  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses
     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then
    insert into public.invite_attempts (ip_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;
  insert into public.invite_redemptions (code_hash, email, user_id, status) values (c.code_hash, lower(btrim(mail)), p_user, 'sent');
  flipped := ryagram_private.activate_account(p_user, 'code', null, c.grant_credits, 'code:' || c.label);
  return jsonb_build_object('ok', true, 'activated', flipped);
end $$;

-- invite_reserve (20261003000200)
create or replace function public.invite_reserve(p_code text, p_email text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.invite_codes;
  rid bigint;
begin
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10
     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  if coalesce(p_email, '') !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;
  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses
     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then
    insert into public.invite_attempts (ip_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;
  insert into public.invite_redemptions (code_hash, email) values (c.code_hash, lower(btrim(p_email)))
    returning id into rid;
  return jsonb_build_object('ok', true, 'redemption', rid);
end $$;

commit;

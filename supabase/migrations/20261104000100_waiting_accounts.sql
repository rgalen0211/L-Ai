-- WAITING accounts (Option B, Ryan 2026-11-04 11:17): a person can make an account with no invite code; it is LOCKED until access opens. NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- Plan: proposals\CONNECT-WAITING-GATE-PLAN-1104.md (CC1 approved 11-04 13:17).
--
-- THE SWITCH. Nothing changes for anyone until Ryan runs:   update public.ops_settings set waiting_accounts = true;
-- The switch controls how NEW accounts are made and what the pages offer (the join function answers "not open" while it is off; a new account is recorded 'active' while it is off and
-- 'waiting' while it is on). It does NOT unlock anyone: an account whose row says WAITING is gated ALWAYS, switch on or off, so switching off and on again cannot let a waiting account buy
-- credits or pair a computer. An account with NO row is open only while the switch is off (older accounts stay safe); once it is on, no row = not open. To let waiting people in, approve them
-- (the waiting list) or run 22_waiting_accounts_open_all.sql. A migration alone changes nothing visible: every existing account is made active below.
--
-- THE STATE. public.account_status: one row per account, 'waiting' or 'active'. An account with NO row is not active once the switch is on (fail closed). Every account that
-- exists when this file runs (testers, admins, workers) is made ACTIVE below. A worker or an admin counts as active whatever the table says (only Ryan makes those, in SQL).
-- Nobody can write the table through the API: signed-in people may READ their own row, nothing else; the trigger and the functions below are SECURITY DEFINER with a fixed search path.
--
-- THE GATE, four layers (each is a no-op while the switch is off):
--   1. a restrictive row policy on every table that has a policy for signed-in people (except the few a WAITING person must reach);
--   2. ryagram_private.require_active() at the top of EVERY public function a signed-in person can run (a loop below; the allow list is named in it);
--   3. the Edge Functions: _shared/oauth_guard.ts verifyActiveUser (a separate change on this branch);
--   4. credits (grant_credits refuses a waiting account) and the AI connector (connect_person_ok, and plain words on the consent page).
-- tests (supabase/tests/test_waiting_accounts.py) fail when a function or a table is added later without the gate, or without being on the allow list.
--
-- Apply AFTER: 20261031000400. The AI-connector parts (connect_person_ok, the consent page words) are applied only where the connector's migration is there, and again by gate_apply(). The credits ledger (supabase/phase-2b/credits_ledger.sql) may be applied before or after: if it is not there yet,
-- run   select ryagram_private.gate_apply();   once it is (it is safe to run again).

begin;

alter table public.ops_settings add column waiting_accounts boolean not null default false;      -- Ryan's switch: new accounts start WAITING, and the gate bites

-- ---------------------------------------------------------------------------------------------------- the state
create table public.account_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('waiting', 'active')),
  source text not null check (char_length(source) between 1 and 40),     -- backfill | signup | invite | code | approved | dashboard
  since timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null
);
alter table public.account_status enable row level security;
revoke all on public.account_status from public, anon, authenticated, service_role;
grant select on public.account_status to authenticated;
create policy "Owners read their account status" on public.account_status for select to authenticated using (user_id = auth.uid());

create table public.account_status_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  from_status text,
  to_status text not null,
  source text not null,
  by_user uuid references auth.users (id) on delete set null,
  reason text,
  at timestamptz not null default now()
);
alter table public.account_status_audit enable row level security;
revoke all on public.account_status_audit from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- the helpers
create function ryagram_private.waiting_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select o.waiting_accounts from public.ops_settings o limit 1), false)
$$;

-- Is this account open? A row saying active, or an admin, or a worker. A row saying WAITING is never open (the switch does not matter). No row at all: open only while the switch is off.
create function ryagram_private.account_active(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_user is null then not ryagram_private.waiting_on()
              else exists (select 1 from public.account_status s where s.user_id = p_user and s.status = 'active')
                or exists (select 1 from public.app_admins a where a.user_id = p_user)
                or exists (select 1 from public.workers w where w.user_id = p_user)
                or (not ryagram_private.waiting_on() and not exists (select 1 from public.account_status s where s.user_id = p_user))
         end
$$;

-- The row policies below call THIS, as the signed-in person. It lives in public on purpose: the credits ledger file revokes every ryagram_private function from signed-in people.
create function public.account_gate_ok() returns boolean
language sql stable security definer set search_path = '' as $$ select ryagram_private.account_active(auth.uid()) $$;
revoke execute on function public.account_gate_ok() from public, anon;
grant execute on function public.account_gate_ok() to authenticated;

-- The check at the top of every function a signed-in person can run. No signed-in person (the service role, the dashboard) passes: those are not people.
create function ryagram_private.require_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not ryagram_private.account_active(auth.uid()) then
    raise exception 'Your account is on the waiting list, so this is not open to you yet. We will email you when your access opens.' using errcode = '42501', hint = 'waiting';
  end if;
end $$;

-- CREDITS for a WAITING account are HELD, not refused (a paid month must never fail inside the Stripe webhook and be retried for ever): the ledger is not touched, the grant waits in held_grants,
-- and activate_account pays it when the account opens. No credit row can exist for a waiting account. Returns true when the grant was held.
create table public.held_grants (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  entry text not null, credits int not null check (credits > 0), reason text, created_by text,
  stripe_event_id text, period_key text, price_code text,
  held_at timestamptz not null default now()
);
create unique index held_grants_event on public.held_grants (stripe_event_id) where stripe_event_id is not null;
create unique index held_grants_period on public.held_grants (owner_id, period_key, entry) where period_key is not null;
alter table public.held_grants enable row level security;
revoke all on public.held_grants from public, anon, authenticated, service_role;

create function ryagram_private.hold_grant(p_owner uuid, p_entry text, p_credits int, p_reason text, p_by text, p_event text, p_period text, p_price text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if ryagram_private.account_active(p_owner) then return false; end if;
  insert into public.held_grants (owner_id, entry, credits, reason, created_by, stripe_event_id, period_key, price_code)
    values (p_owner, p_entry, p_credits, left(p_reason, 300), left(p_by, 100), p_event, p_period, p_price) on conflict do nothing;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------- every NEW account is recorded
create function ryagram_private.account_status_new() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_status (user_id, status, source)
    values (new.id, case when ryagram_private.waiting_on() then 'waiting' else 'active' end, case when ryagram_private.waiting_on() then 'signup' else 'backfill' end)
    on conflict (user_id) do nothing;
  return new;
end $$;
create trigger account_status_new_trg after insert on auth.users for each row execute function ryagram_private.account_status_new();

-- Supabase gives PUBLIC execute on new functions: nothing in ryagram_private below is for a signed-in person to run (the row policies call public.account_gate_ok)
revoke execute on function ryagram_private.waiting_on(), ryagram_private.account_active(uuid), ryagram_private.require_active(), ryagram_private.hold_grant(uuid, text, int, text, text, text, text, text),
  ryagram_private.account_status_new() from public, anon, authenticated;

-- every account that exists now is active
insert into public.account_status (user_id, status, source) select u.id, 'active', 'backfill' from auth.users u on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------------- the one way to ACTIVE
-- Flips a waiting account (or one with no row) to active ONCE, writes the audit row, and, only when it really flipped, grants the welcome credits. Returns true when it flipped.
create function ryagram_private.activate_account(p_user uuid, p_source text, p_by uuid, p_credits int, p_note text) returns boolean
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
revoke execute on function ryagram_private.activate_account(uuid, text, uuid, int, text) from public, anon, authenticated;

-- invite_sent (an invited tester): the account is active BEFORE the welcome credits go in, so the credits guard below lets them through. Otherwise unchanged.
create or replace function public.invite_sent(p_redemption bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.invite_redemptions; g int;
begin
  update public.invite_redemptions set status = 'sent', user_id = p_user where id = p_redemption and status = 'pending' returning * into r;
  if r.id is null or p_user is null then
    return;
  end if;
  perform ryagram_private.activate_account(p_user, 'invite', null, 0, 'invite:' || p_redemption);
  select grant_credits into g from public.invite_codes where code_hash = r.code_hash;
  if coalesce(g, 0) > 0 then
    perform public.grant_credits(p_user, 'grant', g, 'Creator beta welcome credits (invite)', 'invite:' || p_redemption);
  end if;
end $$;

-- A signed-in WAITING person enters an invite code (the claim-invite Edge Function calls this with the service role; the address is hashed there). Same throttle and the same
-- tables as redeem-invite. A good code is used up once and the account becomes active with the code's own welcome credits (the same as redeeming it any other way).
create function public.invite_claim(p_user uuid, p_code text, p_ip_hash text) returns jsonb
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
revoke execute on function public.invite_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_claim(uuid, text, text) to service_role;

-- A server-side yes/no for the Edge Functions (they hold the service role and know the user id from the verified token).
create function public.account_is_active(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select ryagram_private.account_active(p_user) $$;
revoke execute on function public.account_is_active(uuid) from public, anon, authenticated;
grant execute on function public.account_is_active(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------- what a signed-in person asks the server about themself
create function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in();
begin
  return jsonb_build_object('status', case when ryagram_private.account_active(me) then 'active' else 'waiting' end,
                            'is_admin', ryagram_private.is_app_admin(), 'gate_on', ryagram_private.waiting_on());
end $$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- ---------------------------------------------------------------------------------------------------- Ryan's list and approve button (admin only, app sessions only)
create function public.admin_waiting_list() returns table (user_id uuid, email text, joined_at timestamptz, confirmed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select s.user_id, u.email::text, s.since, u.email_confirmed_at is not null from public.account_status s join auth.users u on u.id = s.user_id
               where s.status = 'waiting' order by s.since, u.email;
end $$;

-- Approve = active + the normal welcome credits (the creator-flow setting, 20) once. Returns {flipped, email, credits}. The Edge Function approve-waiting calls this as the admin and then sends the email.
create function public.admin_approve_waiting(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin(); c int; flipped boolean; mail text;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'Say why, in a few words.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such account.' using errcode = 'PT404'; end if;
  if exists (select 1 from auth.users where id = p_user and email_confirmed_at is null) then
    raise exception 'That address has not been confirmed yet, so it cannot be approved.' using errcode = '22023';
  end if;
  select invite_credits into c from public.creator_flow_settings;
  select u.email into mail from auth.users u where u.id = p_user;
  flipped := ryagram_private.activate_account(p_user, 'approved', me, c, btrim(p_reason));
  return jsonb_build_object('flipped', flipped, 'email', mail, 'credits', case when flipped then c else 0 end);
end $$;
revoke execute on function public.admin_waiting_list(), public.admin_approve_waiting(uuid, text) from public, anon;
grant execute on function public.admin_waiting_list(), public.admin_approve_waiting(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------- layers 1, 2 and the credits guard, in ONE re-runnable function
-- Run it again (select ryagram_private.gate_apply();) after any later migration or after the credits ledger is applied: it only adds what is missing.
create function ryagram_private.gate_apply() returns text
language plpgsql security definer set search_path = '' as $ga$
declare
  allowed constant text[] := array[
    'funnel_anon', 'record_visit', 'report_film_page', 'service_status', 'submit_support',   -- visitors reach these without an account anyway
    'funnel_attach_source', 'funnel_return_visit',                                            -- page-visit counting; a failure here must never break a page
    'is_app_admin', 'current_engine_commit', 'film_request_cost',                              -- plain facts, no account data
    'my_access', 'account_gate_ok',                                                            -- how a WAITING person learns they are waiting; the row policies' own check
    'connect_consent_check'];                                                                  -- answers in words itself (the consent page text above)
  open_tables constant text[] := array['account_settings', 'account_deletion_requests', 'ryagram_waitlist', 'account_status'];   -- what a WAITING person must reach
  f record; t record; def text; newdef text; res text; vol text; fn regprocedure; n_pl int := 0; n_sql int := 0; n_pol int := 0; ledger text;
begin
  -- credits: a waiting account holds none
  fn := to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)');
  if fn is null then
    ledger := 'the credits ledger is not applied yet (run gate_apply again after it is)';
  else
    def := pg_get_functiondef(fn);
    if def like '%ryagram_private.hold_grant%' then
      ledger := 'grant_credits was already guarded';
    else
      newdef := regexp_replace(def, E'(^|\\n)([ \\t]*begin\\M[^\\n]*\\n)',
                               E'\\1\\2  if ryagram_private.hold_grant(p_owner, p_entry::text, p_credits, p_reason, p_created_by, p_stripe_event_id, p_period_key, p_price_code) then return null; end if;\n', 'i');
      if newdef = def then raise exception 'gate: grant_credits has no BEGIN line to guard'; end if;
      execute newdef;
      ledger := 'grant_credits now holds a grant for a waiting account until it opens';
    end if;
  end if;

  -- the AI connector (only where its tables exist; a later connector migration can undo this, so this runs again too): connect_person_ok also asks account_active,
  -- and the consent page says why in plain words
  if to_regprocedure('ryagram_private.connect_person_ok(uuid)') is not null then
    def := pg_get_functiondef('ryagram_private.connect_person_ok(uuid)'::regprocedure);
    if def not like '%account_active%' then
      newdef := replace(def, 'and not exists (select 1 from public.workers w where w.user_id = p_owner)', E'and not exists (select 1 from public.workers w where w.user_id = p_owner)
     and ryagram_private.account_active(p_owner)');
      if newdef = def then raise exception 'gate: connect_person_ok changed, account_active was not added'; end if;
      execute newdef;
    end if;
  end if;
  if to_regprocedure('public.connect_consent_check(uuid)') is not null then
    def := pg_get_functiondef('public.connect_consent_check(uuid)'::regprocedure);
    if def not like '%account_active(me)%' then
      newdef := replace(def, 'elsif not ryagram_private.connect_person_ok(me) then why :=', 'elsif not ryagram_private.account_active(me) then why := ''Your account is on the waiting list, so it cannot be connected to an AI yet. We will email you when your access opens.'';' || E'
  ' || 'elsif not ryagram_private.connect_person_ok(me) then why :=');
      if newdef = def then raise exception 'gate: connect_consent_check changed, the waiting words were not added'; end if;
      execute newdef;
    end if;
  end if;

  -- layer 2: the check in every function a signed-in person can run
  for f in
    select p.oid, p.oid::regprocedure as sig, p.proname, l.lanname, p.proretset, p.pronargs, p.provolatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
       and p.proname <> all (allowed) and p.prosrc not like '%perform ryagram_private.require_active();%' and p.proname not like '%\_\_ungated'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if f.lanname = 'plpgsql' then
      def := pg_get_functiondef(f.oid);
      newdef := regexp_replace(def, E'(^|\\n)([ \\t]*begin\\M[^\\n]*\\n)', E'\\1\\2  perform ryagram_private.require_active();\n', 'i');
      if newdef = def then raise exception 'gate: no BEGIN line to guard in %', f.sig; end if;
      execute newdef;
      n_pl := n_pl + 1;
    elsif f.lanname = 'sql' then
      -- a SQL function cannot call the check: keep it under a new name nobody can run, and put a guarded plpgsql function of the same name in front of it
      if f.pronargs <> 0 then raise exception 'gate: % takes arguments; wrap it by hand', f.sig; end if;
      res := pg_get_function_result(f.oid);
      vol := case f.provolatile when 'v' then '' else 'stable' end;
      execute format('alter function %s rename to %I', f.sig, f.proname || '__ungated');
      execute format('revoke execute on function public.%I() from public, anon, authenticated', f.proname || '__ungated');
      execute format('create function public.%I() returns %s language plpgsql %s security definer set search_path = '''' as $w$ begin perform ryagram_private.require_active(); %s end $w$',
                     f.proname, res, vol, case when f.proretset then format('return query select * from public.%I();', f.proname || '__ungated')
                                                else format('return public.%I();', f.proname || '__ungated') end);
      execute format('revoke execute on function public.%I() from public, anon', f.proname);
      execute format('grant execute on function public.%I() to authenticated', f.proname);
      n_sql := n_sql + 1;
    else
      raise exception 'gate: % is written in %, which this function does not know', f.sig, f.lanname;
    end if;
  end loop;

  -- layer 1: a restrictive policy on every table with a policy for signed-in people (ANDed with the existing ones)
  for t in
    select distinct pc.schemaname, pc.tablename from pg_policies pc
     where pc.schemaname in ('public', 'storage') and pc.permissive = 'PERMISSIVE' and ('authenticated' = any (pc.roles) or 'public' = any (pc.roles))
       and pc.tablename <> all (open_tables)
       and not exists (select 1 from pg_policies q where q.schemaname = pc.schemaname and q.tablename = pc.tablename and q.policyname = 'account_gate')
  loop
    execute format('create policy account_gate on %I.%I as restrictive for all to authenticated using ((select public.account_gate_ok())) with check ((select public.account_gate_ok()))',
                   t.schemaname, t.tablename);
    n_pol := n_pol + 1;
  end loop;
  return format('waiting gate: %s plpgsql functions guarded, %s SQL functions wrapped, %s tables got the restrictive policy; credits: %s', n_pl, n_sql, n_pol, ledger);
end $ga$;
revoke execute on function ryagram_private.gate_apply() from public, anon, authenticated;

select ryagram_private.gate_apply();

commit;

-- Creator beta flow on Stripe TEST mode (Ryan, 2026-10-16): approve an application and mint an invite code that carries welcome credits; the person signs up with
-- the code; they request a film in the app (it costs credits); Ryan sees it in a queue on #/admin/ops and fulfils it from his PC (a manual-queue stub until
-- BUILDER's job runner has a status file: admin_film_request_set is the single seam it will later call). Review only; nothing here is applied by the web session.
--
-- Apply AFTER: 20261003000200_invite_codes.sql (invites), 20261010000100_ops_readiness.sql (alerts, is_app_admin), 20261014000100_creator_beta.sql (applications),
-- and phase-2b/credits_ledger.sql (the credits ledger). Everything that touches the ledger is plpgsql, so this file can be applied before the ledger, but a film
-- request or a welcome grant raises until the ledger exists.
--
-- Rules this file keeps:
--   * Only Ryan (is_app_admin) can make an invite code or move a request along. Codes are shown ONCE, to him, and stored hashed (invite_issue's own rule).
--   * A request spends credits at once (adjustment rows from the subscription, then granted, then purchased pool: the ledger's own spending order) and a
--     DECLINED request gives exactly those credits back, once. A delivered request keeps them spent. Nothing here can create credits except a decline's refund.
--   * Nothing is sent to anyone: Ryan emails the code and the film himself. Nothing here costs money.

-- ---------------------------------------------------------------- Ryan's two numbers: 10 credits a film, 20 welcome credits (confirmed 2026-10-16)
-- Credits are counted, never priced here: the DOLLAR VALUE of a credit is deliberately UNSET until costmeter has measured real render costs (Ryan, 2026-10-16), so nothing in
-- this file or in the screens that use it stores, computes or shows a price per credit.
create table public.creator_flow_settings (
  id boolean primary key default true check (id),
  film_request_credits int not null default 10 check (film_request_credits between 0 and 1000),     -- what a requested film costs: 10 credits (CONFIRMED by Ryan, 2026-10-16)
  invite_credits int not null default 20 check (invite_credits between 0 and 1000)                  -- the welcome credits on a creator's invite: 20 (CONFIRMED by Ryan, 2026-10-16)
);
insert into public.creator_flow_settings default values;
alter table public.creator_flow_settings enable row level security;
revoke all on table public.creator_flow_settings from anon, authenticated, service_role;

-- ---------------------------------------------------------------- invite -> sign-up -> welcome credits
alter table public.invite_codes add column grant_credits int not null default 0 check (grant_credits between 0 and 1000);
alter table public.creator_applications add column invited_at timestamptz, add column invite_credits int;

-- The invite email went out and the person's account now exists: if the code carries welcome credits, grant them, ONCE (the status only leaves 'pending' once).
create or replace function public.invite_sent(p_redemption bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.invite_redemptions; g int;
begin
  update public.invite_redemptions set status = 'sent', user_id = p_user where id = p_redemption and status = 'pending' returning * into r;
  if r.id is null or p_user is null then
    return;
  end if;
  select grant_credits into g from public.invite_codes where code_hash = r.code_hash;
  if coalesce(g, 0) > 0 then
    perform public.grant_credits(p_user, 'grant', g, 'Creator beta welcome credits (invite)', 'invite:' || p_redemption);
  end if;
end $$;

-- Ryan approves an application AND makes its single-use invite code in one step. Returns the code: shown once, to him; he emails it. A second call for the
-- same application is refused (the code cannot be shown again; make a new one by hand with invite_issue if it was lost).
create function public.admin_creator_invite(p_id bigint, p_credits int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.creator_applications; s public.creator_flow_settings; c int; code text;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can invite creators.' using errcode = '42501';
  end if;
  select * into s from public.creator_flow_settings;
  c := coalesce(p_credits, s.invite_credits);
  if c < 0 or c > 1000 then raise exception 'Welcome credits must be 0 to 1,000.' using errcode = 'P0001'; end if;
  select * into a from public.creator_applications where id = p_id for update;
  if not found then raise exception 'No such application.' using errcode = 'P0001'; end if;
  if a.status = 'declined' then raise exception 'That application was declined.' using errcode = 'P0001'; end if;
  if a.invited_at is not null then raise exception 'An invite was already made for this application.' using errcode = 'P0001'; end if;
  code := public.invite_issue(left('creator #' || a.id || ' ' || a.name, 120), 1, 30);
  update public.invite_codes set grant_credits = c where code_hash = ryagram_private.invite_hash(code);
  update public.creator_applications set status = 'approved', decided_at = coalesce(decided_at, now()), invited_at = now(), invite_credits = c where id = p_id;
  perform ryagram_private.ops_clear('creator:' || p_id);
  return code;
end $$;

-- ---------------------------------------------------------------- film requests: the manual queue
create table public.film_requests (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  question text not null check (char_length(question) between 10 and 1000),
  notes text not null default '' check (char_length(notes) <= 1000),
  credits int not null check (credits >= 0),
  spent jsonb not null default '{}',                              -- {"granted": 10}: which pools paid, so a decline refunds exactly those
  status text not null default 'new' check (status in ('new', 'in_progress', 'delivered', 'declined')),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  delivered_url text check (delivered_url is null or (char_length(delivered_url) <= 500 and delivered_url ~ '^https://[^[:space:]]+$')),
  refunded boolean not null default false
);
create index film_requests_owner_idx on public.film_requests (owner_id, id desc);
alter table public.film_requests enable row level security;
revoke all on table public.film_requests from anon, authenticated, service_role;
create policy "Owners read their film requests" on public.film_requests for select to authenticated using (owner_id = auth.uid());
grant select (id, owner_id, created_at, updated_at, question, notes, credits, status, admin_note, delivered_url) on table public.film_requests to authenticated;

-- A signed-in person asks for a film. It costs film_request_credits, taken now; at most 3 requests open at a time. Returns the request number.
create function public.request_film(p_question text, p_notes text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); q text := regexp_replace(trim(coalesce(p_question, '')), '\s+', ' ', 'g'); n text := trim(coalesce(p_notes, ''));
        cost int; total int; need int; take int; pool text; v_id bigint; v_spent jsonb := '{}'; who text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if char_length(q) < 10 or char_length(q) > 1000 then raise exception 'Tell us the question you want answered (10 to 1,000 characters).' using errcode = 'P0001'; end if;
  if char_length(n) > 1000 then raise exception 'Keep the notes under 1,000 characters.' using errcode = 'P0001'; end if;
  perform ryagram_private.lock_owner(uid);
  if (select count(*) from public.film_requests where owner_id = uid and status in ('new', 'in_progress')) >= 3 then
    raise exception 'You already have 3 film requests waiting. Wait for one to be delivered first.' using errcode = 'P0001';
  end if;
  select film_request_credits into cost from public.creator_flow_settings;
  total := ryagram_private.pool_balance(uid, 'subscription') + ryagram_private.pool_balance(uid, 'granted') + ryagram_private.pool_balance(uid, 'purchased');   -- (plpgsql: the ledger need not exist yet when this file is applied)
  if total < cost then
    raise exception 'Not enough credits: this needs %, and % % available.', cost, greatest(total, 0), case when greatest(total, 0) = 1 then 'is' else 'are' end using errcode = '53400';
  end if;
  insert into public.film_requests (owner_id, question, notes, credits) values (uid, q, n, cost) returning film_requests.id into v_id;
  need := cost;
  foreach pool in array array['subscription', 'granted', 'purchased'] loop
    exit when need = 0;
    take := least(need, greatest(ryagram_private.pool_balance(uid, pool::public.credit_pool), 0));
    if take > 0 then
      insert into public.credit_ledger (owner_id, entry, pool, amount, reason, created_by)
        values (uid, 'adjustment', pool::public.credit_pool, -take, 'Film request #' || v_id, 'film_request');
      v_spent := v_spent || jsonb_build_object(pool, take);
      need := need - take;
    end if;
  end loop;
  if need > 0 then raise exception 'Not enough credits for this request.' using errcode = '53400'; end if;
  update public.film_requests set spent = v_spent where film_requests.id = v_id;
  select email into who from auth.users where auth.users.id = uid;
  perform ryagram_private.ops_raise('film_request:' || v_id, 'New film request #' || v_id || ' from ' || coalesce(who, 'a creator') || ': ' || left(q, 80));
  return v_id;
end $$;

-- Ryan's queue: the open requests (oldest first, 30) and the last 10 finished, with who asked.
create function public.admin_film_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see film requests.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'waiting', (select count(*) from public.film_requests where status in ('new', 'in_progress')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'email', u.email, 'question', r.question, 'notes', r.notes,
                                                         'credits', r.credits, 'status', r.status, 'admin_note', r.admin_note) order by r.id)
                         from (select * from public.film_requests where status in ('new', 'in_progress') order by id limit 30) r
                         left join auth.users u on u.id = r.owner_id), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'email', u.email, 'question', left(r.question, 120), 'status', r.status, 'delivered_url', r.delivered_url,
                                                          'updated_at', r.updated_at) order by r.updated_at desc)
                          from (select * from public.film_requests where status in ('delivered', 'declined') order by updated_at desc limit 10) r
                          left join auth.users u on u.id = r.owner_id), '[]'::jsonb));
end $$;

-- Move a request along: new -> in_progress -> delivered (needs an https link to the film) or declined (gives the credits back, once). Delivered and declined are final.
-- This is the ONE place a future job runner would call.
create function public.admin_film_request_set(p_id bigint, p_status text, p_note text default '', p_url text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.film_requests; pool text; amt int;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can move film requests.' using errcode = '42501';
  end if;
  if p_status not in ('in_progress', 'delivered', 'declined') then raise exception 'Choose in progress, delivered or declined.' using errcode = 'P0001'; end if;
  select * into r from public.film_requests where id = p_id for update;
  if not found then raise exception 'No such request.' using errcode = 'P0001'; end if;
  if r.status in ('delivered', 'declined') then raise exception 'That request is already %.', r.status using errcode = 'P0001'; end if;
  if p_status = 'in_progress' and r.status = 'in_progress' then return; end if;
  if p_status = 'delivered' and coalesce(p_url, '') !~ '^https://[^[:space:]]+$' then
    raise exception 'To mark it delivered, give the https link to the film.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note under 500 characters.' using errcode = 'P0001'; end if;
  if p_status = 'declined' and not r.refunded then
    perform ryagram_private.lock_owner(r.owner_id);
    for pool, amt in select key, value::int from jsonb_each_text(r.spent) loop
      if amt > 0 then
        insert into public.credit_ledger (owner_id, entry, pool, amount, reason, created_by)
          values (r.owner_id, 'adjustment', pool::public.credit_pool, amt, 'Refund for declined film request #' || r.id, 'film_request');
      end if;
    end loop;
  end if;
  update public.film_requests set status = p_status, admin_note = trim(coalesce(p_note, '')), updated_at = now(),
         delivered_url = case when p_status = 'delivered' then p_url end, refunded = (p_status = 'declined' or refunded) where id = p_id;
  perform ryagram_private.ops_clear('film_request:' || p_id);
end $$;

-- Ryan changes his two numbers.
create function public.admin_creator_flow_set(p_film_request_credits int, p_invite_credits int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can change these.' using errcode = '42501';
  end if;
  if p_film_request_credits is null or p_film_request_credits not between 0 and 1000 or p_invite_credits is null or p_invite_credits not between 0 and 1000 then
    raise exception 'Credits must be 0 to 1,000.' using errcode = 'P0001';
  end if;
  update public.creator_flow_settings set film_request_credits = p_film_request_credits, invite_credits = p_invite_credits;
end $$;

-- What a requested film costs, for the app to say so before the person asks.
create function public.film_request_cost() returns int
language sql stable security definer set search_path = '' as $$ select film_request_credits from public.creator_flow_settings $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.film_request_cost(), public.admin_creator_invite(bigint, int), public.request_film(text, text), public.admin_film_requests(),
  public.admin_film_request_set(bigint, text, text, text), public.admin_creator_flow_set(int, int) from public, anon;
grant execute on function public.film_request_cost(), public.admin_creator_invite(bigint, int), public.request_film(text, text), public.admin_film_requests(),
  public.admin_film_request_set(bigint, text, text, text), public.admin_creator_flow_set(int, int) to authenticated;   -- is_app_admin() gates the admin ones; request_film needs a signed-in person

-- First-party funnel tracking (Ryan, 2026-10-17): our own database, no third-party pixels, no cookies. NOT APPLIED. Apply AFTER 20261017000200_invite_someone.sql (it replaces
-- retention_purge again) and after the credits ledger and Stripe tables if they are to be counted (see funnel_install_triggers below).
--
-- WHAT IS KEPT. One row per funnel step reached, with the account that reached it (when there is one) and how that account first found us:
--   utm_source / utm_medium / utm_campaign (typed in the link) and the referrer's DOMAIN (youtube.com): nothing else, no address, no browser details, no cookie.
--   * landing_view, signup_started: anonymous (no account yet). Recorded by funnel_anon(), which anyone may call, only ever adds one row, and stops at 5,000 an hour.
--   * signup_done (first confirmed email), first_project, contact_sheet, preview, render_ordered (a full render was REQUESTED: an order row was made in public.render_orders with want final; it may still be declined, expire or fail, so this counts requests, not renders that ran), render_approved (Ryan approved it: render_stages.admin_decided_at), film_requested, film_delivered, purchase, subscription_start, subscription_cancel:
--     written by TRIGGERS on the tables where those things really happen, so the page cannot invent or skip them.
--   * return_7d, return_30d: the person opens the app 7 / 30 or more days after signing up (funnel_return_visit()).
-- Each account counts once per step (the first time), except purchase and subscription_*, which repeat.
-- The source of an account is attached once, at its first sign-in (funnel_attach_source(); the first answer wins, a later call changes nothing).
-- Deleting an account removes its source row and cuts the link from its events (user_id becomes null); the counts stay.
-- Raw events are deleted 13 months after they happened (retention_purge below; the Privacy draft says so).
-- Only Ryan reads any of it: RLS on both tables with an is_app_admin() policy, and admin_funnel() for #/admin/ops > Funnel.

create table public.funnel_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('landing_view', 'signup_started', 'signup_done', 'first_project', 'contact_sheet', 'preview', 'render_ordered', 'render_approved', 'film_requested', 'film_delivered',
                                       'purchase', 'subscription_start', 'subscription_cancel', 'return_7d', 'return_30d')),
  user_id uuid references auth.users (id) on delete set null,
  utm_source text not null default '' check (utm_source ~ '^[a-z0-9._-]{0,60}$'),
  utm_medium text not null default '' check (utm_medium ~ '^[a-z0-9._-]{0,60}$'),
  utm_campaign text not null default '' check (utm_campaign ~ '^[a-z0-9._-]{0,60}$'),
  referrer_domain text not null default '' check (referrer_domain ~ '^[a-z0-9._-]{0,100}$')
);
create index funnel_events_at on public.funnel_events (at);
-- one row per account per step, except the steps that can repeat
create unique index funnel_events_once on public.funnel_events (user_id, event)
  where user_id is not null and event not in ('purchase', 'subscription_start', 'subscription_cancel');

create table public.funnel_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  utm_source text not null default '' check (utm_source ~ '^[a-z0-9._-]{0,60}$'),
  utm_medium text not null default '' check (utm_medium ~ '^[a-z0-9._-]{0,60}$'),
  utm_campaign text not null default '' check (utm_campaign ~ '^[a-z0-9._-]{0,60}$'),
  referrer_domain text not null default '' check (referrer_domain ~ '^[a-z0-9._-]{0,100}$'),
  attached_at timestamptz not null default now()
);

alter table public.funnel_events enable row level security;
alter table public.funnel_accounts enable row level security;
revoke all on table public.funnel_events, public.funnel_accounts from anon, authenticated, service_role;
grant select on table public.funnel_events, public.funnel_accounts to authenticated;
create policy "Admins read funnel events" on public.funnel_events for select to authenticated using (public.is_app_admin());
create policy "Admins read funnel accounts" on public.funnel_accounts for select to authenticated using (public.is_app_admin());

-- Tidy a source word: lowercase, only letters, digits and . _ -, at most 60 characters (a domain 100).
create function ryagram_private.funnel_clean(p_text text, p_max int default 60) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9._-]', '', 'g'), p_max)
$$;

-- Record one step for an account, with the account's source if it has one. Never raises: counting must never break the thing being counted.
create function ryagram_private.funnel_log(p_event text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.funnel_accounts;
begin
  if p_user is null then return; end if;
  select * into a from public.funnel_accounts where user_id = p_user;
  insert into public.funnel_events (event, user_id, utm_source, utm_medium, utm_campaign, referrer_domain)
  values (p_event, p_user, coalesce(a.utm_source, ''), coalesce(a.utm_medium, ''), coalesce(a.utm_campaign, ''), coalesce(a.referrer_domain, ''))
  on conflict do nothing;
exception when others then
  null;
end $$;

-- ---------------------------------------------------------------- anonymous steps
create function public.funnel_anon(p_event text, p_utm_source text default '', p_utm_medium text default '', p_utm_campaign text default '', p_referrer text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event not in ('landing_view', 'signup_started') then return; end if;
  if (select count(*) from public.funnel_events where event = p_event and at > now() - interval '1 hour') >= 5000 then return; end if;     -- a flood cannot fill the table
  insert into public.funnel_events (event, utm_source, utm_medium, utm_campaign, referrer_domain)
  values (p_event, ryagram_private.funnel_clean(p_utm_source), ryagram_private.funnel_clean(p_utm_medium), ryagram_private.funnel_clean(p_utm_campaign), ryagram_private.funnel_clean(p_referrer, 100));
exception when others then
  null;
end $$;

-- ---------------------------------------------------------------- the account's source, once, at its first sign-in
create function public.funnel_attach_source(p_utm_source text default '', p_utm_medium text default '', p_utm_campaign text default '', p_referrer text default '')
returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s text; m text; c text; r text; n int;
begin
  if me is null then raise exception 'sign in first' using errcode = '28000'; end if;
  s := ryagram_private.funnel_clean(p_utm_source); m := ryagram_private.funnel_clean(p_utm_medium);
  c := ryagram_private.funnel_clean(p_utm_campaign); r := ryagram_private.funnel_clean(p_referrer, 100);
  insert into public.funnel_accounts (user_id, utm_source, utm_medium, utm_campaign, referrer_domain) values (me, s, m, c, r) on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;                                       -- the first answer wins; a later call changes nothing
  -- the steps recorded before the source was known (signup_done) take it too
  update public.funnel_events set utm_source = s, utm_medium = m, utm_campaign = c, referrer_domain = r
    where user_id = me and utm_source = '' and utm_medium = '' and utm_campaign = '' and referrer_domain = '';
  return true;
end $$;

-- The person opened the app 7 / 30 or more days after signing up.
create function public.funnel_return_visit() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); since timestamptz;
begin
  if me is null then return; end if;
  select coalesce(email_confirmed_at, created_at) into since from auth.users where id = me;
  if since is null then return; end if;
  if now() - since >= interval '7 days' then perform ryagram_private.funnel_log('return_7d', me); end if;
  if now() - since >= interval '30 days' then perform ryagram_private.funnel_log('return_30d', me); end if;
end $$;

-- ---------------------------------------------------------------- triggers on the real tables
create function ryagram_private.funnel_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'projects' then
    perform ryagram_private.funnel_log('first_project', new.owner_id);
  elsif tg_table_name = 'jobs' then
    if new.job_type::text = 'contact_sheet' then perform ryagram_private.funnel_log('contact_sheet', new.owner_id);
    elsif new.job_type::text = 'preview' then perform ryagram_private.funnel_log('preview', new.owner_id); end if;
  elsif tg_table_name = 'render_orders' then
    if new.want::text = 'final' then perform ryagram_private.funnel_log('render_ordered', new.owner_id); end if;
  elsif tg_table_name = 'render_stages' then
    -- approval = Ryan's decision stamp appearing on a final render that is not declined or expired (the approve branch stamps it while the stage still awaits; a decline closes the stage in the same update)
    if new.stage::text = 'final_render' and old.admin_decided_at is null and new.admin_decided_at is not null and new.state::text not in ('declined', 'expired') then
      perform ryagram_private.funnel_log('render_approved', new.owner_id);
    end if;
  elsif tg_table_name = 'film_requests' then
    if tg_op = 'INSERT' then perform ryagram_private.funnel_log('film_requested', new.owner_id);
    elsif new.status = 'delivered' and old.status is distinct from 'delivered' then perform ryagram_private.funnel_log('film_delivered', new.owner_id); end if;
  elsif tg_table_name = 'credit_ledger' then
    if new.entry::text = 'purchase' then perform ryagram_private.funnel_log('purchase', new.owner_id); end if;
  elsif tg_table_name = 'stripe_subscriptions' then
    if tg_op = 'INSERT' then perform ryagram_private.funnel_log('subscription_start', new.owner_id);
    elsif (new.cancel_at_period_end and not old.cancel_at_period_end)                                  -- cancel at period end ...
       or (new.status = 'canceled' and old.status is distinct from 'canceled' and not old.cancel_at_period_end) then   -- ... or cancelled at once; the end of an already-counted cancel is not another
      perform ryagram_private.funnel_log('subscription_cancel', new.owner_id);
    end if;
  elsif tg_table_name = 'users' then
    if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then perform ryagram_private.funnel_log('signup_done', new.id); end if;
  end if;
  return null;
exception when others then
  return null;                                                              -- counting never breaks the action
end $$;

-- Some of those tables are made by hand (the credits ledger and Stripe: supabase/phase-2b/*.sql), so the triggers are installed by a function that skips a
-- table that does not exist yet. It runs once now; run it again (select ryagram_private.funnel_install_triggers();) after applying a phase-2b file later.
create function ryagram_private.funnel_install_triggers() returns text
language plpgsql security definer set search_path = '' as $$
declare t record; done text := '';
begin
  for t in select * from (values
      ('public.projects', 'after insert', ''), ('public.jobs', 'after insert', ''), ('public.film_requests', 'after insert or update', ''),
      ('public.render_orders', 'after insert', ''), ('public.render_stages', 'after update', ''), ('public.credit_ledger', 'after insert', ''), ('public.stripe_subscriptions', 'after insert or update', ''),
      ('auth.users', 'after insert or update of email_confirmed_at', '')) as v(tbl, ev, x) loop
    if to_regclass(t.tbl) is not null then
      begin
        execute format('drop trigger if exists funnel_events_trg on %s', t.tbl);
        execute format('create trigger funnel_events_trg %s on %s for each row execute function ryagram_private.funnel_trg()', t.ev, t.tbl);
        done := done || t.tbl || ' ';
      exception when others then
        raise notice 'funnel: could not install the trigger on %: %', t.tbl, sqlerrm;
      end;
    end if;
  end loop;
  return done;
end $$;
-- CC1 MED-1: ryagram_private.funnel_log takes ANY p_user, so it must not be callable by a signed-in person (PUBLIC keeps default EXECUTE on new functions on a real project, and
-- authenticated has USAGE on this schema). Only the definer functions in public.* and the triggers reach these.
revoke execute on function ryagram_private.funnel_clean(text, int), ryagram_private.funnel_log(text, uuid), ryagram_private.funnel_trg() from public, anon, authenticated, service_role;
select ryagram_private.funnel_install_triggers();
revoke execute on function ryagram_private.funnel_install_triggers() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- Ryan's view: counts per step, by week and by source
create function public.admin_funnel(p_weeks int default 8) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w int := least(greatest(coalesce(p_weeks, 8), 1), 52); since timestamptz; out jsonb;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can read the funnel.' using errcode = '42501';
  end if;
  since := date_trunc('week', now() at time zone 'EST5EDT') at time zone 'EST5EDT' - make_interval(weeks => w - 1);
  with ev as (
    select event, coalesce(user_id::text, 'e' || id::text) as who,
           (date_trunc('week', at at time zone 'EST5EDT'))::date as wk,
           coalesce(nullif(utm_source, ''), nullif(referrer_domain, ''), 'direct') as src
      from public.funnel_events where at >= since),
  steps(ord, event) as (values (1, 'landing_view'), (2, 'signup_started'), (3, 'signup_done'), (4, 'first_project'), (5, 'contact_sheet'), (6, 'preview'),
                               (7, 'render_ordered'), (8, 'render_approved'), (9, 'film_requested'), (10, 'film_delivered'), (11, 'purchase'), (12, 'subscription_start'), (13, 'subscription_cancel'), (14, 'return_7d'), (15, 'return_30d')),
  tot as (select event, count(distinct who) n from ev group by event),
  wkly as (select event, wk, count(distinct who) n from ev group by event, wk),
  srcs as (select event, src, count(distinct who) n from ev group by event, src)
  select jsonb_build_object(
    'weeks', (select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb)
                from generate_series((date_trunc('week', now() at time zone 'EST5EDT'))::date - (w - 1) * 7, (date_trunc('week', now() at time zone 'EST5EDT'))::date, interval '7 days') d),
    'steps', (select jsonb_agg(jsonb_build_object(
                 'event', s.event, 'total', coalesce(t.n, 0),
                 'by_week', coalesce((select jsonb_object_agg(to_char(k.wk, 'YYYY-MM-DD'), k.n) from wkly k where k.event = s.event), '{}'::jsonb),
                 'by_source', coalesce((select jsonb_object_agg(k.src, k.n) from (select * from srcs x where x.event = s.event order by x.n desc, x.src limit 20) k), '{}'::jsonb))
                 order by s.ord)
                from steps s left join tot t on t.event = s.event)) into out;
  return out;
end $$;

revoke execute on function public.funnel_anon(text, text, text, text, text), public.funnel_attach_source(text, text, text, text), public.funnel_return_visit(),
  public.admin_funnel(int) from public, anon, authenticated, service_role;
grant execute on function public.funnel_anon(text, text, text, text, text) to anon, authenticated;
grant execute on function public.funnel_attach_source(text, text, text, text), public.funnel_return_visit(), public.admin_funnel(int) to authenticated;   -- admin_funnel refuses non-admins inside

-- ---------------------------------------------------------------- retention: raw events are deleted 13 months after they happened
create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; people int := 0; helps int := 0; reps int := 0; funnel int := 0; ids bigint[];
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  -- Invites Ryan made for a person directly (label 'invite: <name>', admin_invite_person): the code row holds the name and its redemption holds the email.
  -- Removed 12 months after the code was last redeemed, or, if nobody used it, 12 months after it expired. Never earlier: a valid, unused invite stays.
  delete from public.invite_codes c where c.label like 'invite: %'
    and coalesce((select max(r.created_at) from public.invite_redemptions r where r.code_hash = c.code_hash), c.expires_at) < now() - interval '12 months';
  get diagnostics people = row_count;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  -- Funnel events: 13 months after they happened (the account's source row stays while the account does).
  delete from public.funnel_events where at < now() - interval '13 months';
  get diagnostics funnel = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'person_invites', people, 'help_requests', helps, 'reports', reps, 'funnel_events', funnel);
end $$;

revoke execute on function public.retention_purge() from public, anon, authenticated;
grant execute on function public.retention_purge() to service_role;

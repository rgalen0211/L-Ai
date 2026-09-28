-- Ryagram 2B: credits ledger. NOT PART OF THE 2A SET: do not run until Phase 2B is approved.
-- Run after all five 2A files. One transaction.
--
-- Design: Ryagram-logs\proposals\WEB-2B-CREDITS-LEDGER.md, with Ryan's answers (2026-09-28):
--   * the most expensive view in a story sets a film's price (view -> price is a table here;
--     CC1 to confirm the engine's view names);
--   * free previews: 6 per project AND 15 per account per rolling 24 hours; beyond either, 1 credit;
--   * pools are spent subscription, then granted, then purchased (purchased never expire);
--   * a negative balance (only possible through a cash refund) is allowed and blocks new holds.
--
-- The ledger is append-only for everyone. A balance is never stored; it is the sum of rows.
-- Holds, captures and releases happen in triggers on public.jobs, inside the same transaction
-- as the job change, so a job and its credits can never disagree:
--   job inserted (submit_job)        -> quote; free preview, or HOLD (refused if short)
--   job complete                     -> CAPTURE
--   job failed / cancelled / needs an editorial decision -> RELEASE
--   job re-queued for a retry        -> nothing: one hold covers every attempt
-- Every grant/adjustment function is service_role only (Stripe webhooks, Ryan's tools).

begin;

-- ---------------------------------------------------------------- prices, as data

create type public.credit_pool as enum ('subscription', 'granted', 'purchased');
create type public.credit_entry as enum (
  'grant',              -- beta / admin grant                        (+, pool granted)
  'purchase',           -- pack bought (Phase 3, via Stripe)         (+, pool purchased)
  'subscription_grant', -- monthly allowance                         (+, pool subscription)
  'rollover_expiry',    -- subscription credits above 2x allowance    (-, pool subscription)
  'hold',               -- reserved for a job                        (-)
  'capture',            -- the hold is spent                          (0, resolves a hold)
  'release',            -- the hold is returned                       (+, resolves a hold)
  'refund',             -- credits given back after a capture         (+, resolves a capture)
  'purchase_reversal',  -- cash refund of a pack                      (-, pool purchased)
  'adjustment');        -- Ryan's signed correction, with a reason    (+/-)

create table public.credit_prices (
  price_version text not null,
  code text not null,
  credits int not null check (credits >= 0),
  price_cents int check (price_cents >= 0),        -- packs and subscriptions only
  monthly boolean not null default false,
  effective_from timestamptz not null,
  primary key (price_version, code)
);
insert into public.credit_prices (price_version, code, credits, price_cents, monthly, effective_from) values
  ('2026-09', 'pack_starter', 10, 1200, false, '2026-09-01'),
  ('2026-09', 'pack_maker', 28, 3000, false, '2026-09-01'),
  ('2026-09', 'pack_studio', 60, 6000, false, '2026-09-01'),
  ('2026-09', 'sub_creator', 30, 2400, true, '2026-09-01'),
  ('2026-09', 'sub_pro', 100, 6900, true, '2026-09-01'),
  ('2026-09', 'contact_sheet', 0, null, false, '2026-09-01'),
  ('2026-09', 'preview_free', 0, null, false, '2026-09-01'),
  ('2026-09', 'preview_extra', 1, null, false, '2026-09-01'),
  ('2026-09', 'final_line', 6, null, false, '2026-09-01'),
  ('2026-09', 'final_map', 8, null, false, '2026-09-01'),
  ('2026-09', 'final_paired', 10, null, false, '2026-09-01'),
  ('2026-09', 'rebuild_line', 2, null, false, '2026-09-01'),
  ('2026-09', 'rebuild_map', 3, null, false, '2026-09-01'),
  ('2026-09', 'rebuild_paired', 4, null, false, '2026-09-01');

-- Which film price each engine view belongs to. Names confirmed by CC1 from Session.frame_for
-- (2026-09-28): map, bars, line, paired, panel, split, globe; plus "river", which the engine
-- rewrites to map. split and globe at the map price is CC1's judgement, awaiting Ryan's ruling.
-- Every view needs its own row: an unlisted view is refused, never priced at a default.
create table public.credit_view_prices (
  view text primary key check (view ~ '^[a-z_]{1,40}$'),
  price_code text not null check (price_code in ('final_line', 'final_map', 'final_paired')),
  rank int not null                                 -- higher = more expensive; the max wins
);
insert into public.credit_view_prices values
  ('line', 'final_line', 1),
  ('map', 'final_map', 2), ('river', 'final_map', 2), ('split', 'final_map', 2), ('globe', 'final_map', 2),
  ('paired', 'final_paired', 3), ('bars', 'final_paired', 3), ('panel', 'final_paired', 3);

-- Free-preview allowance, tunable without code.
create table public.credit_rules (
  id boolean primary key default true check (id),
  free_previews_per_project int not null default 6,
  free_previews_per_24h int not null default 15,
  subscription_rollover_multiple int not null default 2
);
insert into public.credit_rules default values;

-- ---------------------------------------------------------------- the ledger

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  entry public.credit_entry not null,
  pool public.credit_pool not null,
  amount int not null,
  hold_id uuid,
  resolves_id bigint references public.credit_ledger (id),
  job_id uuid references public.jobs (id) on delete restrict,
  price_version text,
  price_code text,
  stripe_event_id text,
  period_key text,                                 -- subscription billing period, e.g. sub_123:2026-10
  reason text not null check (char_length(reason) between 1 and 500),
  created_by text not null check (char_length(created_by) between 1 and 100),
  check (case entry
    when 'hold' then amount < 0 and hold_id is not null and job_id is not null
    when 'capture' then amount = 0 and resolves_id is not null
    when 'release' then amount > 0 and resolves_id is not null
    when 'refund' then amount > 0 and resolves_id is not null
    when 'rollover_expiry' then amount < 0 and pool = 'subscription'
    when 'purchase_reversal' then amount < 0 and pool = 'purchased'
    when 'adjustment' then amount <> 0
    when 'grant' then amount > 0 and pool = 'granted'
    when 'purchase' then amount > 0 and pool = 'purchased'
    when 'subscription_grant' then amount > 0 and pool = 'subscription' and period_key is not null
  end)
);
-- A hold is resolved exactly once; a capture is refunded at most once.
create unique index credit_ledger_hold_resolved_once on public.credit_ledger (resolves_id)
  where entry in ('capture', 'release');
create unique index credit_ledger_capture_refunded_once on public.credit_ledger (resolves_id)
  where entry = 'refund';
-- A replayed Stripe event, or a second grant for the same billing period, writes nothing.
create unique index credit_ledger_stripe_once on public.credit_ledger (stripe_event_id)
  where stripe_event_id is not null and entry in ('purchase', 'subscription_grant', 'purchase_reversal');
create unique index credit_ledger_period_once on public.credit_ledger (owner_id, period_key)
  where entry = 'subscription_grant';
create index credit_ledger_owner_idx on public.credit_ledger (owner_id, created_at);
create index credit_ledger_job_idx on public.credit_ledger (job_id);

create function ryagram_private.ledger_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The credit ledger is append-only; add an adjustment instead.' using errcode = '42501';
end $$;
create trigger credit_ledger_no_update before update or delete on public.credit_ledger
  for each row execute function ryagram_private.ledger_is_append_only();
create trigger credit_ledger_no_truncate before truncate on public.credit_ledger
  for each statement execute function ryagram_private.ledger_is_append_only();

-- What each job was quoted. Filled by the trigger, never by people.
alter table public.jobs
  add column price_version text,
  add column price_code text,
  add column credits_quoted int check (credits_quoted >= 0),
  add column free_preview boolean not null default false,
  add column hold_id uuid;

-- ---------------------------------------------------------------- helpers

create function ryagram_private.current_price_version() returns text
language sql stable set search_path = '' as $$
  select price_version from public.credit_prices
  where effective_from <= now() group by price_version order by max(effective_from) desc limit 1
$$;

create function ryagram_private.price(p_version text, p_code text) returns int
language sql stable set search_path = '' as $$
  select credits from public.credit_prices where price_version = p_version and code = p_code
$$;

-- The most expensive view in the story sets the price. An unknown view can't be priced.
create function ryagram_private.film_price_code(p_story jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  code text;
  unknown text;
begin
  select v.view into unknown
    from jsonb_array_elements(coalesce(p_story #> '{sequence,clips}', '[]')) c
    cross join lateral (select c->>'view' as view) v
    where c->>'kind' = 'render'
      and not exists (select 1 from public.credit_view_prices p where p.view = v.view)
    limit 1;
  if unknown is not null or exists (
       select 1 from jsonb_array_elements(coalesce(p_story #> '{sequence,clips}', '[]')) c
       where c->>'kind' = 'render' and c->>'view' is null) then
    raise exception 'Can''t price a film with the view "%".', coalesce(unknown, '(none)') using errcode = '22023';
  end if;
  select p.price_code into code
    from jsonb_array_elements(coalesce(p_story #> '{sequence,clips}', '[]')) c
    join public.credit_view_prices p on p.view = c->>'view'
    where c->>'kind' = 'render'
    order by p.rank desc limit 1;
  if code is null then
    raise exception 'A final film needs at least one data view to be priced.' using errcode = '22023';
  end if;
  return code;
end $$;

-- Available credits per pool (sum of rows). Callers hold the owner's advisory lock.
create function ryagram_private.pool_balance(p_owner uuid, p_pool public.credit_pool) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(amount), 0)::int from public.credit_ledger where owner_id = p_owner and pool = p_pool
$$;

create function ryagram_private.lock_owner(p_owner uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_owner::text, 2026))
$$;

-- Free previews counted against the allowance: every free preview submitted, except those
-- that ended in an infrastructure failure (not the person's doing).
create function ryagram_private.free_previews_used(p_owner uuid, p_project uuid, p_since timestamptz)
returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.jobs
  where owner_id = p_owner and job_type = 'preview' and free_preview
    and (p_project is null or project_id = p_project)
    and (p_since is null or created_at >= p_since)
    and not (state = 'failed' and error_class = 'infrastructure')
$$;

-- ---------------------------------------------------------------- quote + hold (on insert)

create function ryagram_private.jobs_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rules public.credit_rules;
begin
  select * into rules from public.credit_rules where id;
  new.price_version := ryagram_private.current_price_version();
  perform ryagram_private.lock_owner(new.owner_id);      -- serialises the allowance count too
  if new.job_type = 'contact_sheet' then
    new.price_code := 'contact_sheet';
  elsif new.job_type = 'preview' then
    if ryagram_private.free_previews_used(new.owner_id, new.project_id, null) < rules.free_previews_per_project
       and ryagram_private.free_previews_used(new.owner_id, null, now() - interval '24 hours') < rules.free_previews_per_24h then
      new.price_code := 'preview_free';
      new.free_preview := true;
    else
      new.price_code := 'preview_extra';
    end if;
  else
    new.price_code := ryagram_private.film_price_code(new.story);
  end if;
  new.credits_quoted := ryagram_private.price(new.price_version, new.price_code);
  if new.credits_quoted is null then
    raise exception 'No price for % in price list %.', new.price_code, new.price_version using errcode = '22023';
  end if;
  if new.credits_quoted > 0 then
    new.hold_id := gen_random_uuid();
  end if;
  return new;
end $$;
create trigger jobs_quote before insert on public.jobs
  for each row execute function ryagram_private.jobs_quote();

create function ryagram_private.jobs_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  need int := new.credits_quoted;
  pool public.credit_pool;
  take int;
  total int;
begin
  if coalesce(need, 0) = 0 then
    return null;
  end if;
  -- lock taken in jobs_quote (same transaction)
  total := ryagram_private.pool_balance(new.owner_id, 'subscription')
         + ryagram_private.pool_balance(new.owner_id, 'granted')
         + ryagram_private.pool_balance(new.owner_id, 'purchased');
  if total < need then
    raise exception 'Not enough credits: this needs %, and % % available.', need, greatest(total, 0),
      case when greatest(total, 0) = 1 then 'is' else 'are' end using errcode = '53400';
  end if;
  foreach pool in array array['subscription', 'granted', 'purchased']::public.credit_pool[] loop
    exit when need = 0;
    take := least(need, greatest(ryagram_private.pool_balance(new.owner_id, pool), 0));
    if take > 0 then
      insert into public.credit_ledger (owner_id, entry, pool, amount, hold_id, job_id, price_version, price_code, reason, created_by)
        values (new.owner_id, 'hold', pool, -take, new.hold_id, new.id, new.price_version, new.price_code,
                'Hold for ' || new.job_type || ' ' || new.id, 'system');
      need := need - take;
    end if;
  end loop;
  if need > 0 then     -- pools can't cover it even though the total did (a negative pool)
    raise exception 'Not enough credits for this job.' using errcode = '53400';
  end if;
  return null;
end $$;
create trigger jobs_hold after insert on public.jobs
  for each row execute function ryagram_private.jobs_hold();

-- ---------------------------------------------------------------- capture / release (on state)

create function ryagram_private.jobs_settle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hold_id is null or new.state = old.state then
    return null;
  end if;
  if new.state = 'complete' then
    insert into public.credit_ledger (owner_id, entry, pool, amount, resolves_id, job_id, reason, created_by)
      select h.owner_id, 'capture', h.pool, 0, h.id, h.job_id, 'Job complete', 'system'
      from public.credit_ledger h
      where h.hold_id = new.hold_id and h.entry = 'hold'
        and not exists (select 1 from public.credit_ledger r where r.resolves_id = h.id and r.entry in ('capture', 'release'));
  elsif new.state in ('failed', 'cancelled', 'editorial_action_required') then
    insert into public.credit_ledger (owner_id, entry, pool, amount, resolves_id, job_id, reason, created_by)
      select h.owner_id, 'release', h.pool, -h.amount, h.id, h.job_id,
             'Job ' || new.state::text || coalesce(' (' || new.error_code || ')', ''), 'system'
      from public.credit_ledger h
      where h.hold_id = new.hold_id and h.entry = 'hold'
        and not exists (select 1 from public.credit_ledger r where r.resolves_id = h.id and r.entry in ('capture', 'release'));
  end if;
  return null;
end $$;
create trigger jobs_settle after update of state on public.jobs
  for each row execute function ryagram_private.jobs_settle();

-- ---------------------------------------------------------------- service_role functions

-- Beta/admin grants (2B), purchases (Phase 3, one per Stripe event), subscription months (one per
-- billing period, capped at 2x the allowance first). Returns the new row id, or null when the
-- Stripe event or billing period was already granted (a replay is not an error).
create function public.grant_credits(
  p_owner uuid, p_entry public.credit_entry, p_credits int, p_reason text, p_created_by text,
  p_stripe_event_id text default null, p_period_key text default null, p_price_code text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  pool public.credit_pool;
  rules public.credit_rules;
  over int;
  row_id bigint;
begin
  pool := case p_entry when 'grant' then 'granted' when 'purchase' then 'purchased'
                       when 'subscription_grant' then 'subscription' end;
  if pool is null then
    raise exception 'grant_credits only grants, purchases and subscription months.' using errcode = '22023';
  end if;
  if coalesce(p_credits, 0) <= 0 then
    raise exception 'Grant a positive number of credits.' using errcode = '22023';
  end if;
  perform ryagram_private.lock_owner(p_owner);
  if p_stripe_event_id is not null and exists (
       select 1 from public.credit_ledger where stripe_event_id = p_stripe_event_id
         and entry in ('purchase', 'subscription_grant', 'purchase_reversal')) then
    return null;
  end if;
  if p_entry = 'subscription_grant' then
    if p_period_key is null then
      raise exception 'A subscription grant needs its billing period.' using errcode = '22023';
    end if;
    if exists (select 1 from public.credit_ledger where owner_id = p_owner and period_key = p_period_key
                 and entry = 'subscription_grant') then
      return null;
    end if;
    select * into rules from public.credit_rules where id;
    over := ryagram_private.pool_balance(p_owner, 'subscription') + p_credits - rules.subscription_rollover_multiple * p_credits;
    if over > 0 then
      insert into public.credit_ledger (owner_id, entry, pool, amount, period_key, reason, created_by)
        values (p_owner, 'rollover_expiry', 'subscription', -over, p_period_key,
                'Rollover above ' || rules.subscription_rollover_multiple || 'x the monthly allowance', p_created_by);
    end if;
  end if;
  insert into public.credit_ledger (owner_id, entry, pool, amount, stripe_event_id, period_key, price_code, reason, created_by)
    values (p_owner, p_entry, pool, p_credits, p_stripe_event_id, p_period_key, p_price_code, p_reason, p_created_by)
    returning id into row_id;
  return row_id;
end $$;

-- Post-capture credit adjustment (Test 20): gives a finished job's credits back, once, to the
-- pools they came from.
create function public.refund_job(p_job_id uuid, p_reason text, p_created_by text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  given int;
begin
  select owner_id into owner from public.jobs where id = p_job_id;
  if owner is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform ryagram_private.lock_owner(owner);
  with refunded as (
    insert into public.credit_ledger (owner_id, entry, pool, amount, resolves_id, job_id, reason, created_by)
      select c.owner_id, 'refund', c.pool, -h.amount, c.id, c.job_id, p_reason, p_created_by
      from public.credit_ledger c join public.credit_ledger h on h.id = c.resolves_id
      where c.job_id = p_job_id and c.entry = 'capture'
        and not exists (select 1 from public.credit_ledger r where r.resolves_id = c.id and r.entry = 'refund')
    returning amount)
  select coalesce(sum(amount), 0)::int into given from refunded;
  if given = 0 then
    raise exception 'Nothing to refund: the job was never charged, or was refunded already.' using errcode = '22023';
  end if;
  return given;
end $$;

-- Cash refund of a pack (Phase 3): removes the credits bought, even if that leaves the balance
-- negative; a negative balance blocks new holds until credits are added.
create function public.reverse_purchase(p_purchase_event_id text, p_refund_event_id text, p_created_by text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  p public.credit_ledger;
  row_id bigint;
begin
  select * into p from public.credit_ledger where stripe_event_id = p_purchase_event_id and entry = 'purchase';
  if not found then
    raise exception 'No purchase for that payment.' using errcode = 'P0002';
  end if;
  perform ryagram_private.lock_owner(p.owner_id);
  if exists (select 1 from public.credit_ledger where stripe_event_id = p_refund_event_id) then
    return null;                                     -- replayed refund webhook
  end if;
  insert into public.credit_ledger (owner_id, entry, pool, amount, resolves_id, stripe_event_id, price_code, reason, created_by)
    values (p.owner_id, 'purchase_reversal', 'purchased', -p.amount, p.id, p_refund_event_id, p.price_code,
            'Cash refund of ' || coalesce(p.price_code, 'a purchase'), p_created_by)
    returning id into row_id;
  return row_id;
end $$;
create unique index credit_ledger_purchase_reversed_once on public.credit_ledger (resolves_id)
  where entry = 'purchase_reversal';

-- Ryan's signed correction, always with a reason and who made it.
create function public.adjust_credits(p_owner uuid, p_pool public.credit_pool, p_amount int, p_reason text, p_created_by text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare row_id bigint;
begin
  if coalesce(p_amount, 0) = 0 then
    raise exception 'An adjustment must change the balance.' using errcode = '22023';
  end if;
  perform ryagram_private.lock_owner(p_owner);
  insert into public.credit_ledger (owner_id, entry, pool, amount, reason, created_by)
    values (p_owner, 'adjustment', p_pool, p_amount, p_reason, p_created_by)
    returning id into row_id;
  return row_id;
end $$;

-- What a job would cost right now, for the page to show before the click. Never charges.
create function public.credit_quote(p_version_id uuid, p_job_type public.job_type)
returns table (price_code text, credits int, free_preview boolean, available int)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  rules public.credit_rules;
  pv text := ryagram_private.current_price_version();
  code text;
  free boolean := false;
begin
  select * into v from public.versions where id = p_version_id and owner_id = me;
  if not found then
    raise exception 'Version not found.' using errcode = 'P0002';
  end if;
  select * into rules from public.credit_rules where id;
  if p_job_type = 'contact_sheet' then code := 'contact_sheet';
  elsif p_job_type = 'preview' then
    free := ryagram_private.free_previews_used(me, v.project_id, null) < rules.free_previews_per_project
        and ryagram_private.free_previews_used(me, null, now() - interval '24 hours') < rules.free_previews_per_24h;
    code := case when free then 'preview_free' else 'preview_extra' end;
  else code := ryagram_private.film_price_code(v.story_spec);
  end if;
  return query select code, ryagram_private.price(pv, code), free,
    (ryagram_private.pool_balance(me, 'subscription') + ryagram_private.pool_balance(me, 'granted')
     + ryagram_private.pool_balance(me, 'purchased'));
end $$;

-- ---------------------------------------------------------------- read models

-- Balances are always derived. security_invoker: people see only their own rows.
create view public.credit_balances with (security_invoker = true) as
  select l.owner_id, l.pool,
         sum(l.amount)::int as available,
         coalesce(-sum(l.amount) filter (where l.entry = 'hold' and not exists (
           select 1 from public.credit_ledger r where r.resolves_id = l.id and r.entry in ('capture', 'release'))), 0)::int as held
  from public.credit_ledger l
  group by l.owner_id, l.pool;

-- Test 21: one row per job answering what it cost and what happened, without console archaeology.
create view public.job_accounting with (security_invoker = true) as
  select j.id as job_id, j.owner_id, j.project_id, j.version_id, j.job_type, j.state, j.attempt,
         j.error_class, j.error_code, j.engine_commit,
         j.price_version, j.price_code, j.credits_quoted, j.free_preview,
         coalesce(-sum(l.amount) filter (where l.entry = 'hold'), 0)::int as held,
         coalesce(-sum(h.amount) filter (where l.entry = 'capture'), 0)::int as captured,
         coalesce(sum(l.amount) filter (where l.entry = 'release'), 0)::int as released,
         coalesce(sum(l.amount) filter (where l.entry = 'refund'), 0)::int as refunded,
         (select count(*) from public.job_metering m where m.job_id = j.id)::int as attempts_metered,
         (select sum(m.wall_s) from public.job_metering m where m.job_id = j.id) as wall_s_total,
         (select a.sha256 from public.artifacts a where a.job_id = j.id and a.kind in ('final_video', 'preview', 'contact_sheet')
            order by a.created_at desc limit 1) as output_sha256,
         (select a.storage_path from public.artifacts a where a.job_id = j.id and a.kind = 'receipt' limit 1) as receipt_path
  from public.jobs j
  left join public.credit_ledger l on l.job_id = j.id
  left join public.credit_ledger h on h.id = l.resolves_id
  group by j.id;

-- ---------------------------------------------------------------- access

alter table public.credit_ledger enable row level security;
alter table public.credit_prices enable row level security;
alter table public.credit_view_prices enable row level security;
alter table public.credit_rules enable row level security;
revoke all on public.credit_ledger, public.credit_prices, public.credit_view_prices, public.credit_rules,
  public.credit_balances, public.job_accounting from anon, authenticated, service_role;
grant select on public.credit_ledger, public.credit_prices, public.credit_view_prices,
  public.credit_balances, public.job_accounting to authenticated;
create policy "Owners read their ledger" on public.credit_ledger for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Signed-in people read prices" on public.credit_prices for select to authenticated using (true);
create policy "Signed-in people read view prices" on public.credit_view_prices for select to authenticated using (true);

revoke execute on all functions in schema ryagram_private from public, anon, authenticated;
grant execute on function ryagram_private.owner_may_read(text), ryagram_private.worker_may_write(text),
  ryagram_private.is_worker() to authenticated;       -- re-grant the ones policies need
revoke execute on function
  public.grant_credits(uuid, public.credit_entry, int, text, text, text, text, text),
  public.refund_job(uuid, text, text),
  public.reverse_purchase(text, text, text),
  public.adjust_credits(uuid, public.credit_pool, int, text, text),
  public.credit_quote(uuid, public.job_type)
  from public, anon, authenticated;
grant execute on function
  public.grant_credits(uuid, public.credit_entry, int, text, text, text, text, text),
  public.refund_job(uuid, text, text),
  public.reverse_purchase(text, text, text),
  public.adjust_credits(uuid, public.credit_pool, int, text, text)
  to service_role;
grant execute on function public.credit_quote(uuid, public.job_type) to authenticated;

commit;

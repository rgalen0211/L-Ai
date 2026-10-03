-- Ryagram: Stripe payments, test mode first. NOT APPLIED. Run after phase-2b/credits_ledger.sql.
-- One transaction.
--
-- Money in, credits out, through the tested ledger only:
--   pack bought      checkout.session.completed (paid)   -> grant_credits(..., 'purchase', ...)
--   plan month paid  invoice.paid (create or cycle)       -> grant_credits(..., 'subscription_grant', ...)
--   pack refunded    charge.refunded (in full)            -> reverse_purchase(...)
--   plan changes     customer.subscription.*              -> stripe_subscriptions (what the app shows)
--
-- The stripe-webhook Edge Function checks Stripe's signature, pulls the few fields below out of
-- the event, and calls stripe_apply once per event. Every decision is made here, in one
-- transaction: a replayed event changes nothing, and the ledger's own unique index on
-- stripe_event_id is the second guard.
--
-- Outcomes, all recorded in stripe_events:
--   applied        credits or plan state changed
--   ignored        nothing to do (unpaid checkout, zero-amount invoice, an event type we don't use)
--   needs_review   something didn't add up (amount, unknown price or customer, partial refund):
--                  nothing changed, and the webhook still answers 200 so Stripe stops retrying.
--                  Ryan resolves these by hand (adjust_credits / grant_credits), reading `detail`.
--   refused_live   a live-mode event while stripe_settings.live_ok is false
-- A database error raises instead, the webhook answers 500, and Stripe retries later.

begin;

create table public.stripe_settings (
  id boolean primary key default true check (id),
  live_ok boolean not null default false,          -- flip only when going live, with Ryan's OK
  currency text not null default 'usd'
);
insert into public.stripe_settings default values;

-- Ryan fills this after creating the products in Stripe (supabase/README.md, "Stripe").
create table public.stripe_prices (
  price_code text primary key,                     -- a code in credit_prices: pack_* or sub_*
  stripe_price_id text not null unique check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  mode text not null check (mode in ('payment', 'subscription')),
  active boolean not null default true
);

-- One Stripe customer per person, created by stripe-checkout before the first checkout, so
-- every later event (invoices, refunds) finds its owner through the customer id.
create table public.stripe_customers (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  customer_id text not null unique check (customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now()
);

create table public.stripe_subscriptions (
  subscription_id text primary key check (subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  price_code text,
  status text not null,                            -- Stripe's: active, past_due, canceled, ...
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  event_created timestamptz not null,              -- events can arrive out of order: newest wins
  updated_at timestamptz not null default now()
);
create index stripe_subscriptions_owner on public.stripe_subscriptions (owner_id);

-- A pack payment, so a refund (which names only the payment intent) finds its purchase.
create table public.stripe_payments (
  payment_intent text primary key check (payment_intent ~ '^pi_[A-Za-z0-9]+$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  price_code text not null,
  checkout_session text not null unique,
  purchase_event_id text not null,
  amount_cents int not null,
  created_at timestamptz not null default now()
);

create table public.stripe_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null,
  livemode boolean not null,
  outcome text not null check (outcome in ('applied', 'ignored', 'needs_review', 'refused_live')),
  detail text,
  owner_id uuid,
  received_at timestamptz not null default now()
);
create index stripe_events_review on public.stripe_events (received_at) where outcome = 'needs_review';

-- ---------------------------------------------------------------- helpers

-- The current price row for a code (the latest price version in effect).
create function ryagram_private.current_price(p_code text) returns public.credit_prices
language sql stable set search_path = '' as $$
  select * from public.credit_prices
  where price_version = ryagram_private.current_price_version() and code = p_code
$$;

create function ryagram_private.stripe_owner(p_customer text) returns uuid
language sql stable set search_path = '' as $$
  select owner_id from public.stripe_customers where customer_id = p_customer
$$;

-- checkout.session.completed / checkout.session.async_payment_succeeded
-- p_data: session_id, mode, payment_status, owner_id (client_reference_id), customer,
--         price_code (metadata), amount_total, currency, payment_intent, subscription
create function ryagram_private.stripe_checkout(p_event_id text, p_data jsonb, p_currency text,
                                                out outcome text, out detail text, out owner uuid)
language plpgsql set search_path = '' as $$
declare
  code text := p_data->>'price_code';
  mapped uuid;
  price public.credit_prices;
  paid int;
  credits int;
begin
  if coalesce(p_data->>'owner_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    outcome := 'needs_review'; detail := 'Checkout has no Ryagram user (client_reference_id).'; return;
  end if;
  owner := (p_data->>'owner_id')::uuid;
  if not exists (select 1 from auth.users where id = owner) then
    outcome := 'needs_review'; detail := 'Checkout names a user who does not exist.'; owner := null; return;
  end if;
  mapped := ryagram_private.stripe_owner(p_data->>'customer');
  if mapped is distinct from owner then
    outcome := 'needs_review';
    detail := 'The Stripe customer on this checkout is not the one stripe-checkout made for this user.';
    return;
  end if;

  if p_data->>'mode' = 'subscription' then
    -- Credits come with each paid invoice (invoice.paid), which may arrive before this event.
    -- Record the plan so the app can show it; subscription events fill in the rest.
    if p_data->>'subscription' is not null then
      insert into public.stripe_subscriptions (subscription_id, owner_id, price_code, status, event_created)
        values (p_data->>'subscription', owner, code, 'incomplete', '-infinity')
        on conflict (subscription_id) do nothing;
    end if;
    outcome := 'applied'; detail := 'Plan checkout complete; credits arrive with each paid invoice.';
    return;
  end if;
  if p_data->>'mode' <> 'payment' then
    outcome := 'ignored'; detail := 'Checkout mode ' || coalesce(p_data->>'mode', 'none') || ' is not used.'; return;
  end if;
  if p_data->>'payment_status' is distinct from 'paid' then
    -- Delayed payment methods: checkout.session.async_payment_succeeded follows when it settles.
    outcome := 'ignored'; detail := 'Not paid yet (' || coalesce(p_data->>'payment_status', 'unknown') || ').'; return;
  end if;

  price := ryagram_private.current_price(code);
  if price.code is null or price.monthly or price.price_cents is null or code !~ '^pack_' then
    outcome := 'needs_review'; detail := 'Paid for an unknown pack: ' || coalesce(code, 'no price_code') || '.'; return;
  end if;
  paid := (p_data->>'amount_total')::int;
  if paid is distinct from price.price_cents or lower(coalesce(p_data->>'currency', '')) <> p_currency then
    outcome := 'needs_review';
    detail := format('Paid %s %s for %s, which costs %s %s. No credits given.',
                     coalesce(paid::text, 'nothing'), coalesce(p_data->>'currency', '?'), code, price.price_cents, p_currency);
    return;
  end if;
  if coalesce(p_data->>'payment_intent', '') !~ '^pi_[A-Za-z0-9]+$' then
    outcome := 'needs_review'; detail := 'Paid checkout without a payment intent.'; return;
  end if;
  if exists (select 1 from public.stripe_payments where checkout_session = p_data->>'session_id'
                                                     or payment_intent = p_data->>'payment_intent') then
    outcome := 'ignored'; detail := 'This checkout was credited already.'; return;
  end if;

  credits := price.credits;
  if public.grant_credits(owner, 'purchase', credits, 'Bought ' || code, 'stripe', p_event_id, null, code) is null then
    outcome := 'ignored'; detail := 'The ledger already has this event.'; return;
  end if;
  insert into public.stripe_payments (payment_intent, owner_id, price_code, checkout_session, purchase_event_id, amount_cents)
    values (p_data->>'payment_intent', owner, code, p_data->>'session_id', p_event_id, paid);
  outcome := 'applied'; detail := format('%s credits for %s.', credits, code);
end $$;

-- invoice.paid
-- p_data: invoice_id, customer, subscription, price_id, billing_reason, amount_paid, currency,
--         period_start (epoch seconds of the subscription line's period)
create function ryagram_private.stripe_invoice_paid(p_event_id text, p_data jsonb, p_currency text,
                                                    out outcome text, out detail text, out owner uuid)
language plpgsql set search_path = '' as $$
declare
  code text;
  price public.credit_prices;
  paid int := (p_data->>'amount_paid')::int;
  period_key text;
begin
  if p_data->>'subscription' is null then
    outcome := 'ignored'; detail := 'Not a subscription invoice.'; return;
  end if;
  owner := ryagram_private.stripe_owner(p_data->>'customer');
  if owner is null then
    outcome := 'needs_review'; detail := 'Invoice for a Stripe customer Ryagram did not create.'; return;
  end if;
  select price_code into code from public.stripe_prices
    where stripe_price_id = p_data->>'price_id' and mode = 'subscription';
  price := ryagram_private.current_price(code);
  if price.code is null or not price.monthly then
    outcome := 'needs_review'; detail := 'Invoice for an unknown plan price: ' || coalesce(p_data->>'price_id', 'none') || '.'; return;
  end if;
  if coalesce(paid, 0) = 0 then
    outcome := 'ignored'; detail := 'Nothing was paid.'; return;
  end if;
  if p_data->>'billing_reason' not in ('subscription_create', 'subscription_cycle') then
    -- Plan switches are off in the customer portal; if one happens anyway, Ryan decides.
    outcome := 'needs_review'; detail := 'Invoice for ' || coalesce(p_data->>'billing_reason', 'no reason') || '; no credits given.'; return;
  end if;
  if paid <> price.price_cents or lower(coalesce(p_data->>'currency', '')) <> p_currency then
    outcome := 'needs_review';
    detail := format('Paid %s %s for %s, which costs %s %s. No credits given.', paid, coalesce(p_data->>'currency', '?'),
                     code, price.price_cents, p_currency);
    return;
  end if;
  if coalesce(p_data->>'period_start', '') !~ '^[0-9]+$' then
    outcome := 'needs_review'; detail := 'Invoice without a billing period.'; return;
  end if;
  period_key := (p_data->>'subscription') || ':'
                || to_char(to_timestamp((p_data->>'period_start')::bigint) at time zone 'UTC', 'YYYY-MM-DD');
  if public.grant_credits(owner, 'subscription_grant', price.credits, 'Monthly credits: ' || code, 'stripe',
                          p_event_id, period_key, code) is null then
    outcome := 'ignored'; detail := 'This billing period was credited already.'; return;
  end if;
  outcome := 'applied'; detail := format('%s monthly credits for %s (%s).', price.credits, code, period_key);
end $$;

-- customer.subscription.created / updated / deleted
-- p_data: subscription, customer, status, price_id, current_period_end (epoch), cancel_at_period_end
create function ryagram_private.stripe_subscription(p_created timestamptz, p_data jsonb,
                                                    out outcome text, out detail text, out owner uuid)
language plpgsql set search_path = '' as $$
declare
  code text;
begin
  owner := ryagram_private.stripe_owner(p_data->>'customer');
  if owner is null then
    outcome := 'needs_review'; detail := 'Subscription for a Stripe customer Ryagram did not create.'; return;
  end if;
  select price_code into code from public.stripe_prices where stripe_price_id = p_data->>'price_id';
  insert into public.stripe_subscriptions as s (subscription_id, owner_id, price_code, status, current_period_end,
                                                cancel_at_period_end, event_created)
    values (p_data->>'subscription', owner, code, p_data->>'status',
            case when (p_data->>'current_period_end') ~ '^[0-9]+$' then to_timestamp((p_data->>'current_period_end')::bigint) end,
            coalesce((p_data->>'cancel_at_period_end')::boolean, false), p_created)
  on conflict (subscription_id) do update
    set price_code = coalesce(excluded.price_code, s.price_code), status = excluded.status,
        current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
        event_created = excluded.event_created, updated_at = now()
    where s.owner_id = excluded.owner_id and s.event_created <= excluded.event_created;
  if not found then
    outcome := 'ignored'; detail := 'An older event than the one already recorded.'; return;
  end if;
  outcome := 'applied'; detail := 'Plan ' || coalesce(code, 'unknown') || ' is ' || (p_data->>'status') || '.';
end $$;

-- charge.refunded
-- p_data: charge, payment_intent, amount, amount_refunded, currency
create function ryagram_private.stripe_refund(p_event_id text, p_data jsonb,
                                              out outcome text, out detail text, out owner uuid)
language plpgsql set search_path = '' as $$
declare
  p public.stripe_payments;
begin
  select * into p from public.stripe_payments where payment_intent = p_data->>'payment_intent';
  if not found then
    outcome := 'needs_review'; detail := 'Refund of a payment that is not a pack (a plan invoice?). Credits unchanged.'; return;
  end if;
  owner := p.owner_id;
  if coalesce(p_data->>'amount_refunded', '') !~ '^[0-9]+$'
     or (p_data->>'amount_refunded')::int is distinct from (p_data->>'amount')::int then   -- partial, or amounts missing
    outcome := 'needs_review';
    detail := format('Partial refund of %s: %s of %s cents. Credits unchanged; adjust by hand if needed.',
                     p.price_code, p_data->>'amount_refunded', p_data->>'amount');
    return;
  end if;
  if exists (select 1 from public.credit_ledger r join public.credit_ledger b on b.id = r.resolves_id
             where b.stripe_event_id = p.purchase_event_id and b.entry = 'purchase' and r.entry = 'purchase_reversal') then
    outcome := 'ignored'; detail := 'Already reversed.'; return;      -- a second refund event for the same payment
  end if;
  if public.reverse_purchase(p.purchase_event_id, p_event_id, 'stripe') is null then
    outcome := 'ignored'; detail := 'Already reversed.'; return;
  end if;
  outcome := 'applied'; detail := 'Refunded ' || p.price_code || '; its credits were removed.';
end $$;

-- ---------------------------------------------------------------- the one entry point

create function public.stripe_apply(p_event_id text, p_type text, p_created timestamptz, p_livemode boolean, p_data jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  settings public.stripe_settings;
  r record;
begin
  if coalesce(p_event_id, '') !~ '^evt_[A-Za-z0-9]+$' then
    raise exception 'Not a Stripe event id.' using errcode = '22023';
  end if;
  -- Two deliveries of the same event (Stripe retries overlap) take turns here.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id, 3));
  if exists (select 1 from public.stripe_events where event_id = p_event_id) then
    return 'replay';
  end if;
  select * into settings from public.stripe_settings where id;

  if p_livemode and not settings.live_ok then
    select 'refused_live' as outcome, 'Live-mode event while Stripe is in test mode.' as detail, null::uuid as owner into r;
  elsif p_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    select * into r from ryagram_private.stripe_checkout(p_event_id, p_data, settings.currency);
  elsif p_type = 'invoice.paid' then
    select * into r from ryagram_private.stripe_invoice_paid(p_event_id, p_data, settings.currency);
  elsif p_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    select * into r from ryagram_private.stripe_subscription(p_created, p_data);
  elsif p_type = 'charge.refunded' then
    select * into r from ryagram_private.stripe_refund(p_event_id, p_data);
  else
    select 'ignored' as outcome, 'Event type not used.' as detail, null::uuid as owner into r;
  end if;

  insert into public.stripe_events (event_id, type, livemode, outcome, detail, owner_id)
    values (p_event_id, p_type, p_livemode, r.outcome, r.detail, r.owner);
  return r.outcome;
end $$;

-- What stripe-checkout needs to start a checkout or open the billing portal.
create function public.stripe_checkout_context(p_owner uuid, p_price_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stripe_price_id', (select stripe_price_id from public.stripe_prices where price_code = p_price_code and active),
    'mode', (select mode from public.stripe_prices where price_code = p_price_code and active),
    'customer_id', (select customer_id from public.stripe_customers where owner_id = p_owner),
    'email', (select email from auth.users where id = p_owner),
    'has_plan', exists (select 1 from public.stripe_subscriptions where owner_id = p_owner
                          and status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid')),
    'live_ok', (select live_ok from public.stripe_settings where id))
$$;

-- Records the customer stripe-checkout created. A second, different customer for the same
-- person is refused (the checkout function uses an idempotency key, so it shouldn't happen).
create function public.stripe_set_customer(p_owner uuid, p_customer text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stripe_customers (owner_id, customer_id) values (p_owner, p_customer)
    on conflict (owner_id) do nothing;
  if not exists (select 1 from public.stripe_customers where owner_id = p_owner and customer_id = p_customer) then
    raise exception 'This person already has a different Stripe customer.' using errcode = '23505';
  end if;
end $$;

-- ---------------------------------------------------------------- access

alter table public.stripe_settings enable row level security;
alter table public.stripe_prices enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.stripe_subscriptions enable row level security;
alter table public.stripe_payments enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.stripe_settings, public.stripe_prices, public.stripe_customers, public.stripe_subscriptions,
  public.stripe_payments, public.stripe_events from anon, authenticated, service_role;

-- The app shows a person their own plan, and which codes are on sale.
grant select (price_code, mode, active) on public.stripe_prices to authenticated;
create policy "Signed-in people see what is on sale" on public.stripe_prices for select to authenticated using (active);
grant select (subscription_id, price_code, status, current_period_end, cancel_at_period_end, owner_id)
  on public.stripe_subscriptions to authenticated;
create policy "Owners see their plan" on public.stripe_subscriptions for select to authenticated
  using (owner_id = (select auth.uid()));

revoke execute on all functions in schema ryagram_private from public, anon, authenticated;
grant execute on function ryagram_private.owner_may_read(text), ryagram_private.worker_may_write(text),
  ryagram_private.is_worker() to authenticated;       -- re-grant the ones policies need
revoke execute on function
  public.stripe_apply(text, text, timestamptz, boolean, jsonb),
  public.stripe_checkout_context(uuid, text),
  public.stripe_set_customer(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.stripe_apply(text, text, timestamptz, boolean, jsonb),
  public.stripe_checkout_context(uuid, text),
  public.stripe_set_customer(uuid, text)
  to service_role;

commit;

-- PAYMENTS (refund rule, chargebacks, the server buying lock): the exact undo of phase-2b/stripe_refunds_disputes.sql (LAUNCH-LIVE-STEPS P3 / F6).
-- NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident. GEO 2026-11-22.
-- BEFORE running it: (1) remove charge.dispute.created and charge.dispute.closed from the Stripe webhook (P5), and
-- (2) redeploy stripe-checkout and stripe-webhook from the commit before the buying lock (the new checkout reads buying_open,
-- and reads a missing key as CLOSED, so with the new function deployed this undo would shut checkout for everyone).
-- It puts public.stripe_apply, ryagram_private.stripe_refund and public.stripe_checkout_context back EXACTLY as
-- phase-2b/stripe_test_mode.sql defines them (copied from that file by script; create or replace keeps their grants),
-- then drops ryagram_private.stripe_dispute, the table public.stripe_partial_refunds and stripe_settings.buying_open.
-- LOST with them: the partial-refund records and the switch's value. Events already recorded in stripe_events stay as they are.
-- Ends with gate_apply where it exists, like the file it undoes. The whole file is one transaction.
begin;

-- stripe_apply first: the new body calls stripe_dispute, so it goes back before stripe_dispute is dropped
create or replace function public.stripe_apply(p_event_id text, p_type text, p_created timestamptz, p_livemode boolean, p_data jsonb)
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

create or replace function ryagram_private.stripe_refund(p_event_id text, p_data jsonb,
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

create or replace function public.stripe_checkout_context(p_owner uuid, p_price_code text)
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

drop function ryagram_private.stripe_dispute(text, text, jsonb);
drop table public.stripe_partial_refunds;
alter table public.stripe_settings drop column buying_open;

do $g$ begin if to_regprocedure('ryagram_private.gate_apply()') is not null then perform ryagram_private.gate_apply(); end if; end $g$;

commit;

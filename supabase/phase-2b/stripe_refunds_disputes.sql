-- Ryagram: chargebacks and second refunds (GEO 2026-11-21, CC1 10:4x; GEO-SECURITY-PRIVACY-REVIEW-1121 M6 and L1). NOT APPLIED.
-- Run AFTER phase-2b/stripe_test_mode.sql. One transaction. Changes nothing already recorded.
--
--   charge.dispute.created   a pack payment is disputed   -> needs_review (credits unchanged: the dispute may still be won)
--   charge.dispute.closed    lost                         -> the pack is reversed, as a full refund is (once only)
--                            won, or an inquiry closed     -> ignored (credits unchanged)
--   charge.refunded          in full, AFTER an earlier partial refund of the same payment
--                                                         -> needs_review (it used to reverse ALL the pack's credits, even
--                                                            after Ryan had adjusted the partial by hand: a double debit)
--
-- Stripe must send the two dispute events to the webhook endpoint (supabase/README.md, the events list).
begin;

-- A payment that had a partial refund: any later "refunded in full" for it is held for review.
create table public.stripe_partial_refunds (
  payment_intent text primary key,
  first_event_id text not null,
  recorded_at timestamptz not null default now()
);
alter table public.stripe_partial_refunds enable row level security;
revoke all on public.stripe_partial_refunds from anon, authenticated, service_role;

-- charge.refunded (replaces stripe_test_mode.sql's version; the same inputs and outputs)
-- p_data: charge, payment_intent, amount, amount_refunded, currency
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
    insert into public.stripe_partial_refunds (payment_intent, first_event_id) values (p.payment_intent, p_event_id)
      on conflict (payment_intent) do nothing;
    outcome := 'needs_review';
    detail := format('Partial refund of %s: %s of %s cents. Credits unchanged; adjust by hand if needed.',
                     p.price_code, p_data->>'amount_refunded', p_data->>'amount');
    return;
  end if;
  if exists (select 1 from public.credit_ledger r join public.credit_ledger b on b.id = r.resolves_id
             where b.stripe_event_id = p.purchase_event_id and b.entry = 'purchase' and r.entry = 'purchase_reversal') then
    outcome := 'ignored'; detail := 'Already reversed.'; return;      -- a second refund event for the same payment
  end if;
  if exists (select 1 from public.stripe_partial_refunds where payment_intent = p.payment_intent) then
    outcome := 'needs_review';
    detail := format('Refund of %s is now in full, after an earlier partial refund that was held for review. Credits unchanged; '
                     'adjust by hand (whatever was done for the partial is not undone).', p.price_code);
    return;
  end if;
  if public.reverse_purchase(p.purchase_event_id, p_event_id, 'stripe') is null then
    outcome := 'ignored'; detail := 'Already reversed.'; return;
  end if;
  outcome := 'applied'; detail := 'Refunded ' || p.price_code || '; its credits were removed.';
end $$;

-- charge.dispute.created / charge.dispute.closed
-- p_data: dispute, charge, payment_intent, amount, currency, status, reason
create function ryagram_private.stripe_dispute(p_event_id text, p_type text, p_data jsonb,
                                               out outcome text, out detail text, out owner uuid)
language plpgsql set search_path = '' as $$
declare
  p public.stripe_payments;
  st text := coalesce(p_data->>'status', '');
begin
  select * into p from public.stripe_payments where payment_intent = p_data->>'payment_intent';
  if not found then
    outcome := 'needs_review'; detail := 'Dispute on a payment that is not a pack (a plan invoice?). Credits unchanged.'; return;
  end if;
  owner := p.owner_id;
  if p_type = 'charge.dispute.created' then
    outcome := 'needs_review';
    detail := format('Dispute opened on %s (%s cents, reason %s). Credits unchanged until it closes; if it is lost they are removed.',
                     p.price_code, coalesce(p_data->>'amount', '?'), coalesce(p_data->>'reason', 'not given'));
    return;
  end if;
  -- charge.dispute.closed
  if st <> 'lost' then
    outcome := 'ignored'; detail := format('Dispute on %s closed as %s. Credits unchanged.', p.price_code, coalesce(nullif(st, ''), 'no status'));
    return;
  end if;
  if exists (select 1 from public.credit_ledger r join public.credit_ledger b on b.id = r.resolves_id
             where b.stripe_event_id = p.purchase_event_id and b.entry = 'purchase' and r.entry = 'purchase_reversal') then
    outcome := 'ignored'; detail := 'Already reversed.'; return;      -- refunded, or a dispute already lost
  end if;
  if exists (select 1 from public.stripe_partial_refunds where payment_intent = p.payment_intent) then
    outcome := 'needs_review';
    detail := format('Dispute lost on %s after an earlier partial refund that was held for review. Credits unchanged; adjust by hand.',
                     p.price_code);
    return;
  end if;
  if public.reverse_purchase(p.purchase_event_id, p_event_id, 'stripe') is null then
    outcome := 'ignored'; detail := 'Already reversed.'; return;
  end if;
  outcome := 'applied'; detail := 'Dispute lost on ' || p.price_code || '; its credits were removed.';
end $$;

-- The one entry point (replaces stripe_test_mode.sql's version; only the dispute branch is new; its grants are kept)
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
  elsif p_type in ('charge.dispute.created', 'charge.dispute.closed') then
    select * into r from ryagram_private.stripe_dispute(p_event_id, p_type, p_data);
  else
    select 'ignored' as outcome, 'Event type not used.' as detail, null::uuid as owner into r;
  end if;

  insert into public.stripe_events (event_id, type, livemode, outcome, detail, owner_id)
    values (p_event_id, p_type, p_livemode, r.outcome, r.detail, r.owner);
  return r.outcome;
end $$;

-- The new helper runs only inside stripe_apply (as stripe_test_mode.sql does for the others).
revoke execute on function ryagram_private.stripe_dispute(text, text, jsonb) from public, anon, authenticated;

-- Run by hand after the waiting-list gate exists (it does on live), re-apply its guards as every migration does; skipped where it does not.
do $g$ begin if to_regprocedure('ryagram_private.gate_apply()') is not null then perform ryagram_private.gate_apply(); end if; end $g$;

commit;

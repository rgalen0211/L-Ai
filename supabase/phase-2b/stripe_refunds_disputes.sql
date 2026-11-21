-- Ryagram: chargebacks and second refunds (GEO 2026-11-21, CC1 10:4x; GEO-SECURITY-PRIVACY-REVIEW-1121 M6 and L1; CC1 10:57 r2). NOT APPLIED.
-- Run AFTER phase-2b/stripe_test_mode.sql and BEFORE the two dispute events are added to the Stripe webhook (supabase/README.md): an
-- event that arrives first is recorded as not used, and its later deliveries replay as that. One transaction. Changes nothing recorded.
--
--   charge.dispute.created   a pack payment is disputed   -> needs_review (credits unchanged: the dispute may still be won)
--                            (its credits already gone)    -> ignored (nothing to do)
--   charge.dispute.closed    lost, for the pack's amount   -> the pack is reversed, as a full refund is (once only)
--                            lost, for a different amount  -> needs_review (a partial chargeback: adjust by hand)
--                            won, or an inquiry closed     -> ignored (credits unchanged)
--   charge.refunded          in full, AFTER an earlier partial refund of the same payment
--                                                         -> needs_review (it used to reverse ALL the pack's credits, even
--                                                            after Ryan had adjusted the partial by hand: a double debit)
--                            any refund AFTER the credits were taken back
--                                                         -> ignored (no hand change needed)
--                            in full, more than 14 days after the pack was bought, or after any of its credits were used
--                                                         -> needs_review (Ryan 11:30 refund rule, 'unused credits refundable
--                                                            within 14 days'; it used to take a spent pack into a negative
--                                                            balance). Only a full refund of an unused pack inside 14 days
--                                                            is reversed. Plan (subscription) invoices: never reversed here.
--
-- stripe_partial_refunds starts EMPTY: partial refunds recorded before this file was run are not in it (their stripe_events rows say
-- 'Partial refund of ...' but do not name the payment). Before running this on live, check those rows by hand (README).
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
  pack_credits int;
  unused int;
begin
  select * into p from public.stripe_payments where payment_intent = p_data->>'payment_intent';
  if not found then
    outcome := 'needs_review'; detail := 'Refund of a payment that is not a pack (a plan invoice?). Credits unchanged.'; return;
  end if;
  owner := p.owner_id;
  -- First: credits already taken back (a full refund or a lost dispute) means nothing is left to adjust, whatever this refund is.
  if exists (select 1 from public.credit_ledger r join public.credit_ledger b on b.id = r.resolves_id
             where b.stripe_event_id = p.purchase_event_id and b.entry = 'purchase' and r.entry = 'purchase_reversal') then
    outcome := 'ignored';
    detail := format('Already reversed: the credits for %s were already taken back, so this refund needs no hand change.', p.price_code);
    return;
  end if;
  if coalesce(p_data->>'amount_refunded', '') !~ '^[0-9]+$'
     or (p_data->>'amount_refunded')::int is distinct from (p_data->>'amount')::int then   -- partial, or amounts missing
    insert into public.stripe_partial_refunds (payment_intent, first_event_id) values (p.payment_intent, p_event_id)
      on conflict (payment_intent) do nothing;
    outcome := 'needs_review';
    detail := format('Partial refund of %s: %s of %s cents. Credits unchanged; adjust by hand if needed.',
                     p.price_code, p_data->>'amount_refunded', p_data->>'amount');
    return;
  end if;
  if exists (select 1 from public.stripe_partial_refunds where payment_intent = p.payment_intent) then
    outcome := 'needs_review';
    detail := format('Refund of %s is now in full, after an earlier partial refund that was held for review. Credits unchanged; '
                     'adjust by hand (whatever was done for the partial is not undone).', p.price_code);
    return;
  end if;
  -- Ryan 11:30 (2026-11-21), the Refunds page: 'unused credits refundable within 14 days'. Stripe has already returned the
  -- money when this arrives, so a refund outside the rule is never reversed here: it is held for Ryan, who decides by hand
  -- (adjust_credits), instead of silently taking credits that were already spent into a negative balance.
  if p.created_at < now() - interval '14 days' then
    outcome := 'needs_review';
    detail := format('Refund of %s more than 14 days after it was bought (%s). Credits unchanged; Ryan decides by hand.',
                     p.price_code, to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD'));
    return;
  end if;
  perform ryagram_private.lock_owner(p.owner_id);          -- the balance below cannot move under us
  select amount into pack_credits from public.credit_ledger where stripe_event_id = p.purchase_event_id and entry = 'purchase';
  if not found then
    outcome := 'needs_review'; detail := format('Refund of %s, but its purchase is not in the ledger. Credits unchanged.', p.price_code); return;
  end if;
  -- credits are pooled, so 'unused' means the purchased balance (credits held for a running render already count as used)
  -- still covers the whole pack
  unused := ryagram_private.pool_balance(p.owner_id, 'purchased');
  if unused < pack_credits then
    outcome := 'needs_review';
    detail := format('Refund of %s after some of its credits were used: %s of its %s credits are unused. Credits unchanged; '
                     'Ryan decides by hand (taking the whole pack back would leave a negative balance).',
                     p.price_code, greatest(unused, 0), pack_credits);
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
  reversed boolean;
begin
  select * into p from public.stripe_payments where payment_intent = p_data->>'payment_intent';
  if not found then
    outcome := 'needs_review'; detail := 'Dispute on a payment that is not a pack (a plan invoice?). Credits unchanged.'; return;
  end if;
  owner := p.owner_id;
  reversed := exists (select 1 from public.credit_ledger r join public.credit_ledger b on b.id = r.resolves_id
                      where b.stripe_event_id = p.purchase_event_id and b.entry = 'purchase' and r.entry = 'purchase_reversal');
  if p_type = 'charge.dispute.created' then
    if reversed then
      outcome := 'ignored';
      detail := format('Dispute opened on %s, whose credits were already taken back. Nothing to do.', p.price_code);
      return;
    end if;
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
  if reversed then
    outcome := 'ignored'; detail := 'Already reversed.'; return;      -- refunded, or a dispute already lost
  end if;
  if coalesce(p_data->>'amount', '') !~ '^[0-9]+$' or (p_data->>'amount')::int <> p.amount_cents then
    outcome := 'needs_review';
    detail := format('Partial chargeback on %s: %s of %s cents lost. Credits unchanged; adjust by hand.',
                     p.price_code, coalesce(p_data->>'amount', '?'), p.amount_cents);
    return;
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

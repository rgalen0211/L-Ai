-- LIVE STEP 69: OPEN BUYING (CONNECT 2026-11-24; CC1 09:33). NOT FOR WEDNESDAY: payments stay OFF on launch day. Branch connect-checkout-use-tax-1124. Run only when CC1 names it AND the Stripe side (live products and prices, the live webhook, the live key in the function secrets, the Ohio Tax Rates, the vendor's license) is done: that part is Ryan's own and GEO's paper lists it. Nothing here touches Stripe.
-- DO IT IN THIS ORDER, each part on its own in the SQL Editor. Part 2 and part 4 are the only writes. Every part says what a good answer looks like.
--   PART 1 (read-only)  the state before: the two switches must read false, and how many test customers and subscriptions exist.
--   PART 2 (the write)  swap the five test price ids for the live ones (you type them), keep the old ones for the undo, clear the TEST customers and subscriptions (a live key cannot use a test customer), and set live_ok true. buying_open stays FALSE.
--                        Then, with buying still closed: in the app, signed in as the administrator, buy the cheapest pack with a real card, then refund it in Stripe's dashboard. Only an administrator can check out while buying is closed.
--   PART 3 (read-only)  your own live purchase and refund both arrived: the answer must show 1 and 1.
--   PART 4 (the write)  BUYING OPEN: refuses unless every check passes (live_ok, a live purchase AND refund seen, the price ids are not the test ones, the Ohio rates are loaded and every rate has its Stripe id). It sets buying_open true and lets signed-in people read price_cents again.
-- THE SAFETY: the stripe-checkout function itself refuses every checkout while buying is open and its key is a TEST key (anyone could pay with Stripe's public test card), so a wrong order is stopped there too.
-- UNDO: live step 70 (buying closed again, test ids and live_ok restored, prices hidden again).

-- PART 1 (read-only)
select (select live_ok from public.stripe_settings where id) as live_ok_now,
       (select buying_open from public.stripe_settings where id) as buying_open_now,
       (select count(*) from public.stripe_prices where active) as active_price_rows,
       (select count(*) from public.stripe_customers) as test_customers,
       (select count(*) from public.stripe_subscriptions) as test_subscriptions,
       (select count(*) from public.stripe_events where livemode) as live_events_so_far,
       (select count(*) from public.ohio_zip_county) as ohio_zips_loaded,
       (select count(*) from public.tax_rates where stripe_tax_rate_id is not null) as tax_rates_with_stripe_id;

-- PART 2 (the write): TYPE THE FIVE LIVE PRICE IDS (price_...) from Stripe's LIVE dashboard in place of each price_REPLACE_ME, then run the whole block.
do $do$
declare
  vals jsonb := '{"pack_starter": "price_REPLACE_ME", "pack_maker": "price_REPLACE_ME", "pack_studio": "price_REPLACE_ME", "sub_creator": "price_REPLACE_ME", "sub_pro": "price_REPLACE_ME"}';
  k text; v text; n int;
begin
  if (select s.buying_open from public.stripe_settings s where s.id) then raise exception 'Not run: buying is already open (step 70 closes it first).'; end if;
  if exists (select 1 from public.stripe_events where livemode) then raise exception 'Not run: a live Stripe event is already recorded, so this is not the first switch. Ask CC1.'; end if;
  -- the keys must be exactly the active price codes
  if (select array_agg(price_code order by price_code) from public.stripe_prices where active) is distinct from (select array_agg(j.k order by j.k) from jsonb_object_keys(vals) as j(k)) then
    raise exception 'Not run: the five codes typed here are not the active price codes in public.stripe_prices.';
  end if;
  for k, v in select * from jsonb_each_text(vals) loop
    if v !~ '^price_[A-Za-z0-9]+$' or v like '%REPLACE%' then raise exception 'Not run: % has no real live price id yet.', k; end if;
    if exists (select 1 from public.stripe_prices where price_code = k and stripe_price_id = v) then raise exception 'Not run: % is still the old (test) price id.', k; end if;
  end loop;
  if (select count(distinct value) from jsonb_each_text(vals)) <> (select count(*) from jsonb_each_text(vals)) then raise exception 'Not run: two codes have the same price id.'; end if;
  -- keep the test ids for the undo (only the first time)
  create table if not exists ryagram_private.stripe_prices_test_ids (price_code text primary key, stripe_price_id text not null, saved_at timestamptz not null default now());
  revoke all on ryagram_private.stripe_prices_test_ids from public, anon, authenticated, service_role;
  insert into ryagram_private.stripe_prices_test_ids (price_code, stripe_price_id) select price_code, stripe_price_id from public.stripe_prices on conflict (price_code) do nothing;
  for k, v in select * from jsonb_each_text(vals) loop
    update public.stripe_prices set stripe_price_id = v where price_code = k;
  end loop;
  delete from public.stripe_subscriptions;                  -- TEST subscriptions: a live key cannot read them
  delete from public.stripe_customers;                      -- TEST customers: stripe-checkout makes a live one at each person's first checkout
  update public.stripe_settings set live_ok = true where id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Not run: stripe_settings has no row.'; end if;
end $do$;

-- PART 3 (read-only): after your own live test purchase and refund (buying still closed)
select (select count(*) from public.stripe_events e where e.livemode and e.outcome = 'applied' and e.type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')) as live_purchases_applied,
       (select count(*) from public.stripe_events e where e.livemode and e.outcome = 'applied' and e.type = 'charge.refunded') as live_refunds_applied,
       (select live_ok from public.stripe_settings where id) as live_ok_now,
       (select buying_open from public.stripe_settings where id) as buying_open_now;

-- PART 4 (the write): BUYING OPEN. Run only after part 3 shows at least 1 and 1.
do $do$
declare n int;
begin
  if not (select s.live_ok from public.stripe_settings s where s.id) then raise exception 'Not run: live_ok is false (part 2 sets it).'; end if;
  if (select count(*) from public.stripe_events e where e.livemode and e.outcome = 'applied' and e.type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')) < 1
     or (select count(*) from public.stripe_events e where e.livemode and e.outcome = 'applied' and e.type = 'charge.refunded') < 1 then
    raise exception 'Not run: your own live test purchase and its refund have not both arrived (part 3 must show at least 1 and 1).';
  end if;
  if exists (select 1 from public.stripe_prices p join ryagram_private.stripe_prices_test_ids t using (price_code) where p.stripe_price_id = t.stripe_price_id) then
    raise exception 'Not run: a price id is still the test one.';
  end if;
  if (select count(*) from public.ohio_zip_county) = 0 or exists (select 1 from public.tax_rates r where r.active and r.stripe_tax_rate_id is null)
     or exists (select 1 from public.ohio_county_rate c join public.tax_rates r on r.code = c.rate_code where not r.active) then
    raise exception 'Not run: the Ohio rates are not loaded (or a rate has no Stripe Tax Rate id). Without them an Ohio business plan cannot be sold. Ask CC1.';
  end if;
  update public.stripe_settings set buying_open = true where id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Not run: stripe_settings has no row.'; end if;
  grant select (price_cents) on public.credit_prices to authenticated;      -- the prices show again (migration 20261123000800 had hidden them)
end $do$;

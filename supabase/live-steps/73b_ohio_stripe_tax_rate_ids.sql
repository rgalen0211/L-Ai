-- LIVE STEP 73b: PUT THE STRIPE TAX RATE IDS ON THE OHIO RATES (CONNECT; built by tools/gen-ohio-rate-load.py). Run after live step 73 and after you made one Stripe Tax Rate per rate below (percentage, exclusive, Ohio sales tax) in Stripe's LIVE dashboard.
-- Type each Stripe Tax Rate id (txr_...) in place of its txr_REPLACE_ME, then run the whole block. It REFUSES a placeholder, a wrong shape, two rates with the same id, or a list that is not exactly the active rates. All or nothing.
--   oh_0650 = 6.50 percent
--   oh_0675 = 6.75 percent
--   oh_0685 = 6.85 percent
--   oh_0700 = 7.00 percent
--   oh_0725 = 7.25 percent
--   oh_0750 = 7.50 percent
--   oh_0775 = 7.75 percent
--   oh_0780 = 7.80 percent
--   oh_0800 = 8.00 percent
-- UNDO: update public.tax_rates set stripe_tax_rate_id = null;
do $do$
declare vals jsonb := '{"oh_0650": "txr_REPLACE_ME", "oh_0675": "txr_REPLACE_ME", "oh_0685": "txr_REPLACE_ME", "oh_0700": "txr_REPLACE_ME", "oh_0725": "txr_REPLACE_ME", "oh_0750": "txr_REPLACE_ME", "oh_0775": "txr_REPLACE_ME", "oh_0780": "txr_REPLACE_ME", "oh_0800": "txr_REPLACE_ME"}'; k text; v text;
begin
  if (select array_agg(code order by code) from public.tax_rates where active) is distinct from (select array_agg(j.k order by j.k) from jsonb_object_keys(vals) as j(k)) then
    raise exception 'Not run: the codes typed here are not exactly the active rates in public.tax_rates (run live step 73 first).';
  end if;
  for k, v in select * from jsonb_each_text(vals) loop
    if v !~ '^txr_[A-Za-z0-9]+$' or v like '%REPLACE%' then raise exception 'Not run: % has no real Stripe Tax Rate id yet.', k; end if;
  end loop;
  if (select count(distinct value) from jsonb_each_text(vals)) <> (select count(*) from jsonb_each_text(vals)) then raise exception 'Not run: two rates have the same Stripe id.'; end if;
  for k, v in select * from jsonb_each_text(vals) loop
    update public.tax_rates set stripe_tax_rate_id = v where code = k;
  end loop;
end $do$;

-- read-only: which active rates now have their Stripe id
select code, percent, stripe_tax_rate_id is not null as has_stripe_id from public.tax_rates where active order by percent;

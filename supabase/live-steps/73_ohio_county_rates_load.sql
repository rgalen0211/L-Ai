-- LIVE STEP 73: LOAD THE OHIO COUNTY SALES TAX RATES (CONNECT; built by tools/gen-ohio-rate-load.py from the Department of Taxation's own county table: Source: https://tax.ohio.gov/business/sales-and-use-tax/rate-tables/by-county-q4-2026 (Sales and Use Tax Rates by County, effective October 1, 2026 to December 31, 2026), read in a browser by GEO Thu ).
-- NOT FOR WEDNESDAY: payments are off. Needs migration 20261123000900_checkout_tax_profile (the tax tables). Run it only when CC1 names it, AFTER someone has checked every number below against the Department's page. Rates change at the start of each quarter: run the new quarter's file the same way.
-- WHAT: 88 counties and 9 different total rates (6.50, 6.75, 6.85, 7.00, 7.25, 7.50, 7.75, 7.80, 8.00 percent). Each county's TOTAL rate is state 5.75 plus its county rate plus any transit area. The rate of a customer is the one of the county THEY choose.
-- PART 1 (read-only): what is loaded now.  PART 2 (the one write, one block, all or nothing): REFUSES unless exactly 88 counties and every rate is between 5.75 and 9; adds one tax_rates row per distinct rate (its Stripe Tax Rate id stays empty until live step 73b) and points each county at its rate;
-- a rate no county uses any more is switched off. Safe to run twice. PART 3 (read-only): counts after.
-- UNDO: delete from public.ohio_county_rate; update public.tax_rates set active = false;  (an Ohio business plan is then refused 'tax not ready', never sold untaxed).

-- PART 1 (read-only)
select (select count(*) from public.ohio_county_rate) as counties_loaded, (select count(*) from public.tax_rates where active) as active_rates,
       (select count(*) from public.tax_rates where active and stripe_tax_rate_id is not null) as rates_with_stripe_id;

-- PART 2 (the write)
do $do$
declare vals jsonb := '[["Adams","7.25"],["Allen","6.85"],["Ashland","7.00"],["Ashtabula","6.75"],["Athens","7.25"],["Auglaize","7.25"],["Belmont","7.25"],["Brown","7.00"],["Butler","6.50"],["Carroll","6.75"],["Champaign","7.25"],["Clark","7.25"],["Clermont","6.75"],["Clinton","7.25"],["Columbiana","7.25"],["Coshocton","7.75"],["Crawford","7.25"],["Cuyahoga","8.00"],["Darke","7.25"],["Defiance","6.75"],["Delaware","7.00"],["Erie","6.75"],["Fairfield","6.75"],["Fayette","7.25"],["Franklin","8.00"],["Fulton","7.25"],["Gallia","7.25"],["Geauga","6.75"],["Greene","6.75"],["Guernsey","7.25"],["Hamilton","7.80"],["Hancock","6.75"],["Hardin","7.25"],["Harrison","7.25"],["Henry","7.25"],["Highland","7.25"],["Hocking","7.25"],["Holmes","7.00"],["Huron","7.25"],["Jackson","7.25"],["Jefferson","7.25"],["Knox","7.25"],["Lake","7.25"],["Lawrence","7.25"],["Licking","7.25"],["Logan","7.25"],["Lorain","6.50"],["Lucas","7.75"],["Madison","7.00"],["Mahoning","7.50"],["Marion","7.25"],["Medina","6.75"],["Meigs","7.25"],["Mercer","7.25"],["Miami","7.00"],["Monroe","7.25"],["Montgomery","7.50"],["Morgan","7.25"],["Morrow","7.25"],["Muskingum","7.25"],["Noble","7.25"],["Ottawa","7.00"],["Paulding","7.25"],["Perry","7.25"],["Pickaway","7.25"],["Pike","7.25"],["Portage","7.00"],["Preble","7.25"],["Putnam","7.00"],["Richland","7.00"],["Ross","7.25"],["Sandusky","7.25"],["Scioto","7.25"],["Seneca","7.25"],["Shelby","7.25"],["Stark","6.50"],["Summit","6.75"],["Trumbull","6.75"],["Tuscarawas","6.75"],["Union","7.00"],["Van Wert","7.25"],["Vinton","7.25"],["Warren","7.25"],["Washington","7.25"],["Wayne","6.50"],["Williams","7.25"],["Wood","6.75"],["Wyandot","7.25"]]';
        e jsonb; n int := 0; r numeric;
begin
  if jsonb_array_length(vals) <> 88 then raise exception 'Not run: the list does not have 88 counties.'; end if;
  if (select count(distinct lower(x ->> 0)) from jsonb_array_elements(vals) x) <> 88 then raise exception 'Not run: a county is listed twice.'; end if;
  for e in select * from jsonb_array_elements(vals) loop
    r := (e ->> 1)::numeric;
    if r < 5.75 or r > 9.00 then raise exception 'Not run: % has a rate outside 5.75 to 9.00.', e ->> 0; end if;
    if (e ->> 0) ~* 'county$' or (e ->> 0) <> btrim(e ->> 0) then raise exception 'Not run: the name % is not written as the Department writes it.', e ->> 0; end if;
  end loop;
  insert into public.tax_rates (code, percent, active, note)
    select 'oh_' || lpad((rate * 100)::int::text, 4, '0'), rate, true, 'Source: https://tax.ohio.gov/business/sales-and-use-tax/rate-tables/by-county-q4-2026 (Sales and Use Tax Rates by County, effective October 1, 2026 to December 31, 2026), read in a browser by GEO Thu '
      from (select distinct (x ->> 1)::numeric as rate from jsonb_array_elements(vals) x) d
    on conflict (code) do update set percent = excluded.percent, active = true, note = excluded.note;
  insert into public.ohio_county_rate (county, rate_code)
    select x ->> 0, 'oh_' || lpad((((x ->> 1)::numeric) * 100)::int::text, 4, '0') from jsonb_array_elements(vals) x
    on conflict (county) do update set rate_code = excluded.rate_code;
  delete from public.ohio_county_rate where county not in (select x ->> 0 from jsonb_array_elements(vals) x);
  update public.tax_rates set active = false where active and code not in (select rate_code from public.ohio_county_rate);
  select count(*) into n from public.ohio_county_rate;
  if n <> 88 then raise exception 'Not run: % counties after loading, expected 88.', n; end if;
end $do$;

-- PART 3 (read-only)
select (select count(*) from public.ohio_county_rate) as counties_loaded, (select count(*) from public.tax_rates where active) as active_rates,
       (select count(*) from public.tax_rates where active and stripe_tax_rate_id is not null) as rates_with_stripe_id;

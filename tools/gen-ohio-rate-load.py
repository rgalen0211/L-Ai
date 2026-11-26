#!/usr/bin/env python3
"""Builds live steps 73 and 73b (the Ohio county tax rates) from the Department of Taxation's county table, saved as a CSV.
CONNECT 2026-11-26 (Claude 14:52 item: the paid switch to merge-ready; GEO's page: the rate is the CUSTOMER's county, state 5.75 + county + transit area).

    python tools/gen-ohio-rate-load.py proposals/OHIO-COUNTY-RATES-Q4-2026.csv [--counties 88] [--out-dir supabase/live-steps]

The CSV: optional lines starting with '#' (put the page address and the effective dates there), a header 'county,total_rate_percent', then one line per county:
the county name EXACTLY as the Department prints it (no word 'County'; 'Van Wert' with its space) and the TOTAL rate the customer pays (state 5.75 + county + any transit area), e.g. 8.00.
It REFUSES anything that does not look right (wrong count, a repeated county, a rate below the state's 5.75 or above 9, a name ending in 'County'): it never guesses.
It writes 73_ohio_county_rates_load.sql (three parts: read-only counts, the one write, read-only counts) and 73b_ohio_stripe_tax_rate_ids.sql (Ryan pastes the Stripe Tax Rate ids he made in Stripe, one per distinct rate).
The numbers come ONLY from the CSV: nothing is typed in here.
"""
import argparse
import csv
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

STATE_RATE = Decimal("5.75")
MAX_RATE = Decimal("9.00")


def read_rows(path, expect):
    text = Path(path).read_text(encoding="utf-8-sig")
    source = [ln.lstrip("#").strip() for ln in text.splitlines() if ln.lstrip().startswith("#")]
    body = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    rd = list(csv.reader(body))
    if not rd or [c.strip().lower() for c in rd[0]] != ["county", "total_rate_percent"]:
        sys.exit("REFUSED: the header must be exactly: county,total_rate_percent")
    rows, seen = [], set()
    for n, r in enumerate(rd[1:], start=2):
        if len(r) != 2:
            sys.exit(f"REFUSED: line {n} does not have exactly two columns: {r}")
        name, rate = r[0].strip(), r[1].strip().rstrip("%")
        if not name or name != re.sub(r"\s+", " ", name):
            sys.exit(f"REFUSED: county name on line {n} is empty or has odd spaces: {name!r}")
        if re.search(r"\bcounty$", name, re.I):
            sys.exit(f"REFUSED: line {n}: write the name without the word County: {name!r}")
        if name.lower() in seen:
            sys.exit(f"REFUSED: county repeated: {name!r}")
        seen.add(name.lower())
        try:
            d = Decimal(rate)
        except InvalidOperation:
            sys.exit(f"REFUSED: line {n}: {rate!r} is not a number")
        if d != d.quantize(Decimal("0.01")):
            sys.exit(f"REFUSED: line {n}: {rate!r} has more than two decimals")
        if d < STATE_RATE or d > MAX_RATE:
            sys.exit(f"REFUSED: line {n}: {name}: {d} is outside {STATE_RATE} to {MAX_RATE} (the total includes the state's {STATE_RATE})")
        rows.append((name, d))
    if len(rows) != expect:
        sys.exit(f"REFUSED: {len(rows)} counties, expected {expect}")
    return rows, source


def code_of(rate):
    return "oh_%04d" % int(rate * 100)


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def build(rows, source, expect):
    rates = sorted({r for _, r in rows})
    quarter_note = (" ".join(source) or "Ohio Department of Taxation county rate table")[:200]
    county_json = json.dumps([[n, str(r)] for n, r in rows], ensure_ascii=True, separators=(",", ":"))
    if "$" in county_json:
        sys.exit("REFUSED: a county name contains a dollar sign")
    county_json = county_json.replace("'", "''")                  # a name with an apostrophe stays inside the SQL string
    codes = [code_of(r) for r in rates]
    load = f"""-- LIVE STEP 73: LOAD THE OHIO COUNTY SALES TAX RATES (CONNECT; built by tools/gen-ohio-rate-load.py from the Department of Taxation's own county table: {quarter_note}).
-- NOT FOR WEDNESDAY: payments are off. Needs migration 20261123000900_checkout_tax_profile (the tax tables). Run it only when CC1 names it, AFTER someone has checked every number below against the Department's page. Rates change at the start of each quarter: run the new quarter's file the same way.
-- WHAT: {len(rows)} counties and {len(rates)} different total rates ({', '.join(str(r) for r in rates)} percent). Each county's TOTAL rate is state 5.75 plus its county rate plus any transit area. The rate of a customer is the one of the county THEY choose.
-- PART 1 (read-only): what is loaded now.  PART 2 (the one write, one block, all or nothing): REFUSES unless exactly {expect} counties and every rate is between 5.75 and 9; adds one tax_rates row per distinct rate (its Stripe Tax Rate id stays empty until live step 73b) and points each county at its rate;
-- a rate no county uses any more is switched off. Safe to run twice. PART 3 (read-only): counts after.
-- UNDO: delete from public.ohio_county_rate; update public.tax_rates set active = false;  (an Ohio business plan is then refused 'tax not ready', never sold untaxed).

-- PART 1 (read-only)
select (select count(*) from public.ohio_county_rate) as counties_loaded, (select count(*) from public.tax_rates where active) as active_rates,
       (select count(*) from public.tax_rates where active and stripe_tax_rate_id is not null) as rates_with_stripe_id;

-- PART 2 (the write)
do $do$
declare vals jsonb := '{county_json}';
        e jsonb; n int := 0; r numeric;
begin
  if jsonb_array_length(vals) <> {expect} then raise exception 'Not run: the list does not have {expect} counties.'; end if;
  if (select count(distinct lower(x ->> 0)) from jsonb_array_elements(vals) x) <> {expect} then raise exception 'Not run: a county is listed twice.'; end if;
  for e in select * from jsonb_array_elements(vals) loop
    r := (e ->> 1)::numeric;
    if r < {STATE_RATE} or r > {MAX_RATE} then raise exception 'Not run: % has a rate outside {STATE_RATE} to {MAX_RATE}.', e ->> 0; end if;
    if (e ->> 0) ~* 'county$' or (e ->> 0) <> btrim(e ->> 0) then raise exception 'Not run: the name % is not written as the Department writes it.', e ->> 0; end if;
  end loop;
  insert into public.tax_rates (code, percent, active, note)
    select 'oh_' || lpad((rate * 100)::int::text, 4, '0'), rate, true, {sql_str(quarter_note)}
      from (select distinct (x ->> 1)::numeric as rate from jsonb_array_elements(vals) x) d
    on conflict (code) do update set percent = excluded.percent, active = true, note = excluded.note;
  insert into public.ohio_county_rate (county, rate_code)
    select x ->> 0, 'oh_' || lpad((((x ->> 1)::numeric) * 100)::int::text, 4, '0') from jsonb_array_elements(vals) x
    on conflict (county) do update set rate_code = excluded.rate_code;
  delete from public.ohio_county_rate where county not in (select x ->> 0 from jsonb_array_elements(vals) x);
  update public.tax_rates set active = false where active and code not in (select rate_code from public.ohio_county_rate);
  select count(*) into n from public.ohio_county_rate;
  if n <> {expect} then raise exception 'Not run: % counties after loading, expected {expect}.', n; end if;
end $do$;

-- PART 3 (read-only)
select (select count(*) from public.ohio_county_rate) as counties_loaded, (select count(*) from public.tax_rates where active) as active_rates,
       (select count(*) from public.tax_rates where active and stripe_tax_rate_id is not null) as rates_with_stripe_id;
"""
    ids = ", ".join(f'"{c}": "txr_REPLACE_ME"' for c in codes)
    legend = "\n".join(f"--   {c} = {r} percent" for c, r in zip(codes, rates))
    ids_sql = f"""-- LIVE STEP 73b: PUT THE STRIPE TAX RATE IDS ON THE OHIO RATES (CONNECT; built by tools/gen-ohio-rate-load.py). Run after live step 73 and after you made one Stripe Tax Rate per rate below (percentage, exclusive, Ohio sales tax) in Stripe's LIVE dashboard.
-- Type each Stripe Tax Rate id (txr_...) in place of its txr_REPLACE_ME, then run the whole block. It REFUSES a placeholder, a wrong shape, two rates with the same id, or a list that is not exactly the active rates. All or nothing.
{legend}
-- UNDO: update public.tax_rates set stripe_tax_rate_id = null;
do $do$
declare vals jsonb := '{{{ids}}}'; k text; v text;
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
"""
    return load, ids_sql


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--counties", type=int, default=88)
    ap.add_argument("--out-dir", default=str(Path(__file__).resolve().parents[1] / "supabase" / "live-steps"))
    a = ap.parse_args()
    rows, source = read_rows(a.csv, a.counties)
    load, ids = build(rows, source, a.counties)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "73_ohio_county_rates_load.sql").write_text(load, encoding="utf-8", newline="\n")
    (out / "73b_ohio_stripe_tax_rate_ids.sql").write_text(ids, encoding="utf-8", newline="\n")
    print(f"wrote 73 and 73b: {len(rows)} counties, {len({r for _, r in rows})} distinct rates")


if __name__ == "__main__":
    main()

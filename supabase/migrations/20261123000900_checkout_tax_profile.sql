-- CHECKOUT: THE ONE QUESTION (business or personal use, and where you are) AND THE PLAN-ONLY OHIO TAX (CONNECT 2026-11-24; CC1 09:33 + 10:23, Ryan's Ohio answers). NOT APPLIED. NOT in the Tuesday or Wednesday head: ships only when Ryan opens buying (live steps 69 and 70 and the Ohio rate step).
-- WHAT: (1) public.account_tax_profile: each person's answer, asked ONCE, stored with its date, changeable; written only by set_my_tax_profile, read only by my_tax_profile (the person's own token) and by stripe_checkout_context (the function's own role).
-- (2) the tax tables: public.tax_rates (a rate's name, its percent and the Stripe Tax Rate id Ryan makes in Stripe), public.ohio_county_rate (county -> rate name) and public.ohio_zip_county (Ohio ZIP -> county). They are EMPTY here: the official rates and ZIPs are loaded by a live step from the Ohio Department of Taxation's own table, so nothing is invented in code.
-- (3) stripe_checkout_context gains four keys (tax_profile, tax_rate_id, tax_county, tax_unknown) and keeps every key it had. The rule: ONLY a monthly PLAN is taxed at checkout, ONLY for use business + United States + Ohio, with the Stripe Tax Rate of the COUNTY the customer chose (GEO 21:40, CC1 21:47: never worked out from a ZIP). A credit PACK is never taxed at checkout (prepaid credits are taxed when used: a later, separate piece, held until Ryan approves it).
-- If a plan would be taxed but the database has no rate for that county, tax_unknown is true and stripe-checkout REFUSES (it never sells that plan untaxed). ohio_zip_county only pre-fills the county question (ohio_counties_for_zip).
-- UNDO: rollbacks/20261123000900_checkout_tax_profile_rollback.sql (puts the old function back and drops the tables; answers already given are lost).
begin;

create table public.account_tax_profile (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  use text not null check (use in ('business', 'personal')),
  country text not null check (country ~ '^[A-Z]{2}$'),
  state text check (state ~ '^[A-Z]{2}$'),
  zip text check (zip ~ '^[0-9]{5}$'),                                   -- kept only to pre-fill the county; never the rate's key
  county text check (county = btrim(county) and county <> ''),            -- Ohio only: the county NAME exactly as in the Department's quarter table (CC1 21:47, GEO 21:40: the customer's county, never a ZIP alone)
  answered_at timestamptz not null default now(),
  check (country <> 'US' or state is not null),
  check (not (state = 'OH' and use = 'business' and county is null)),
  check (state is not distinct from 'OH' or county is null)
);
alter table public.account_tax_profile enable row level security;
revoke all on public.account_tax_profile from anon, authenticated, service_role;

create table public.tax_rates (
  code text primary key check (code ~ '^[a-z0-9_]{1,40}$'),
  percent numeric(6, 4) not null check (percent >= 0 and percent <= 20),
  stripe_tax_rate_id text check (stripe_tax_rate_id ~ '^txr_[A-Za-z0-9]+$'),       -- made in Stripe by Ryan; null until then
  active boolean not null default true,
  note text
);
create table public.ohio_county_rate (
  county text primary key check (county = btrim(county) and county <> ''),
  rate_code text not null references public.tax_rates (code)
);
create table public.ohio_zip_county (                                    -- only to pre-fill the county question: a ZIP can touch more than one county, so a pair is the key
  zip text not null check (zip ~ '^[0-9]{5}$'),
  county text not null check (county = btrim(county) and county <> ''),
  primary key (zip, county)
);
alter table public.tax_rates enable row level security;
alter table public.ohio_county_rate enable row level security;
alter table public.ohio_zip_county enable row level security;
revoke all on public.tax_rates, public.ohio_county_rate, public.ohio_zip_county from anon, authenticated, service_role;

-- The person's own answer: read it, and write it (the only write).
create function public.my_tax_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(t) - 'owner_id' from public.account_tax_profile t where t.owner_id = (select auth.uid())
$$;

create function public.set_my_tax_profile(p_use text, p_country text, p_state text, p_zip text default null, p_county text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c text := upper(btrim(coalesce(p_country, ''))); s text := upper(btrim(coalesce(p_state, ''))); z text := btrim(coalesce(p_zip, '')); k text := btrim(coalesce(p_county, ''));
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_use is distinct from 'business' and p_use is distinct from 'personal' then raise exception 'use_invalid: Choose business or personal use.'; end if;
  if c !~ '^[A-Z]{2}$' then raise exception 'country_invalid: Choose your country.'; end if;
  if c = 'US' then
    if s !~ '^[A-Z]{2}$' then raise exception 'state_required: Choose your state.'; end if;
  else
    s := '';
  end if;
  if s = 'OH' then
    if z <> '' and z !~ '^[0-9]{5}$' then z := ''; end if;                 -- a malformed ZIP is simply not kept: it is only a pre-fill
    if p_use = 'business' then                                             -- the county is what sets the rate: required, and it must be one the rate table knows
      if k = '' then raise exception 'county_required: Choose your Ohio county.'; end if;
      select o.county into k from public.ohio_county_rate o where lower(o.county) = lower(k);    -- the table's own spelling
      if not found then raise exception 'county_unknown: We could not find that Ohio county.'; end if;
    else
      k := '';                                                             -- personal use: never taxed, so no county is kept
    end if;
  else
    z := '';
    k := '';
  end if;
  insert into public.account_tax_profile (owner_id, use, country, state, zip, county, answered_at)
    values (me, p_use, c, nullif(s, ''), nullif(z, ''), nullif(k, ''), now())
    on conflict (owner_id) do update set use = excluded.use, country = excluded.country, state = excluded.state, zip = excluded.zip, county = excluded.county, answered_at = now();
  return public.my_tax_profile();
end $$;

-- The pre-fill the county select asks for: the county names a ZIP touches (none if unknown, one when it is not on a county line).
create function public.ohio_counties_for_zip(p_zip text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select coalesce(array_agg(o.county order by o.county), '{}'::text[]) from public.ohio_zip_county o where o.zip = btrim(coalesce(p_zip, '')));
end $$;                                                    -- plpgsql, not sql: the sign-in gate (gate_apply) wraps a sql function by hand only when it takes no arguments

revoke execute on function public.my_tax_profile() from public, anon;
revoke execute on function public.set_my_tax_profile(text, text, text, text, text) from public, anon;
revoke execute on function public.ohio_counties_for_zip(text) from public, anon;
grant execute on function public.my_tax_profile() to authenticated;
grant execute on function public.set_my_tax_profile(text, text, text, text, text) to authenticated;
grant execute on function public.ohio_counties_for_zip(text) to authenticated;

-- The checkout's context: every old key unchanged, four new ones (see the header). Same name, arguments, owner and grants (create or replace keeps them).
-- GUARD (GAMES 20:55, RENDERER 20:54): the Stripe tables and this function are made by the hand-applied phase-2b files. The shared test template runs every migration BEFORE them, and stripe_test_mode.sql creates the function with a plain
-- 'create function' (it would fail 'already exists' if this ran first). So the replacement happens only where the Stripe tables already exist (live does; a template that loads the phase-2b files and THEN this migration, as test_checkout_tax.py does, does too).
do $g$ begin
if to_regclass('public.stripe_settings') is not null and to_regclass('public.stripe_prices') is not null then
execute $f$
create or replace function public.stripe_checkout_context(p_owner uuid, p_price_code text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $body$
declare prof public.account_tax_profile%rowtype; v_mode text; v_county text; v_rate text; v_unknown boolean := false;
begin
  select * into prof from public.account_tax_profile where owner_id = p_owner;
  select s.mode into v_mode from public.stripe_prices s where s.price_code = p_price_code and s.active;
  if found and prof.owner_id is not null and v_mode = 'subscription' and prof.use = 'business' and prof.country = 'US' and prof.state = 'OH' then
    v_county := prof.county;                                  -- the customer's own county, as they chose it (never worked out from the ZIP)
    if v_county is not null then
      select r.stripe_tax_rate_id into v_rate from public.ohio_county_rate c join public.tax_rates r on r.code = c.rate_code
       where c.county = v_county and r.active;
    end if;
    v_unknown := v_rate is null;                              -- a business plan in Ohio with no rate to give is NEVER sold untaxed
  end if;
  return jsonb_build_object(
    'stripe_price_id', (select stripe_price_id from public.stripe_prices where price_code = p_price_code and active),
    'mode', (select mode from public.stripe_prices where price_code = p_price_code and active),
    'customer_id', (select customer_id from public.stripe_customers where owner_id = p_owner),
    'email', (select email from auth.users where id = p_owner),
    'has_plan', exists (select 1 from public.stripe_subscriptions where owner_id = p_owner
                          and status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid')),
    'live_ok', (select live_ok from public.stripe_settings where id),
    'buying_open', coalesce((select buying_open from public.stripe_settings where id), false),
    'is_admin', exists (select 1 from public.app_admins a where a.user_id = p_owner),
    'tax_profile', case when prof.owner_id is null then null else jsonb_build_object('use', prof.use, 'country', prof.country, 'state', prof.state, 'zip', prof.zip, 'county', prof.county) end,
    'tax_rate_id', v_rate,
    'tax_county', v_county,
    'tax_unknown', v_unknown);
end $body$;
$f$;
end if;
end $g$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

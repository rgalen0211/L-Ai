-- THE EXACT UNDO of migrations/20261123000900_checkout_tax_profile.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts back stripe_checkout_context as phase-2b/stripe_refunds_disputes.sql defines it (no tax keys), drops the two functions and the four tables. WARNING: every business-or-personal answer people gave, and any rows loaded into the tax tables, are LOST: copy them out first (select * from public.account_tax_profile).
-- RUN LIVE STEP 72b FIRST AND SAVE ITS RESULT (it exports the answers this file drops). Run it only while buying is CLOSED: stripe-checkout at the branch that reads tax_profile refuses every checkout when the key is missing.
begin;

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
    'live_ok', (select live_ok from public.stripe_settings where id),
    -- GEO 11-21: buying is a SERVER switch too (the page's buyingOpen only hides buttons); an app admin may still test it
    'buying_open', coalesce((select buying_open from public.stripe_settings where id), false),
    'is_admin', exists (select 1 from public.app_admins a where a.user_id = p_owner))
$$;

drop function public.set_my_tax_profile(text, text, text, text, text);
drop function public.ohio_counties_for_zip(text);
drop function public.my_tax_profile();
-- gate_apply (the closing line of the migration) renames each signed-in-callable function without arguments to NAME__ungated and puts a gated wrapper under the old name: the wrapper was dropped above, the renamed original stays unless it goes too
-- (RENDERER 22:15: otherwise it is an orphan and a later re-apply of the migration fails 'already exists').
drop function if exists public.my_tax_profile__ungated();
drop function if exists public.set_my_tax_profile__ungated(text, text, text, text, text);
drop table public.ohio_zip_county;
drop table public.ohio_county_rate;
drop table public.tax_rates;
drop table public.account_tax_profile;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

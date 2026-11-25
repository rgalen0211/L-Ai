-- LIVE STEP 67 (READ-ONLY): can a signed-in person read the money in the price tables? CONNECT 2026-11-23 (GAMES 18:47, CC1 18:54). Run it BEFORE and AFTER migration 20261123000800 (buying open, step 69 part 4, makes row 2 false again on purpose), and on its own as the one live read GAMES asked for (the committed SQL is not the live database).
-- It changes nothing. Each row answers one question and ends with a true/false; BEFORE the migration row 2 is false by design, AFTER it every row is true.
--   1  anon can read nothing in the price tables
--   2  signed-in people cannot read credit_prices.price_cents
--   3  signed-in people CAN still read credit_prices.credits (the page's film-cost line needs it)
--   4  signed-in people cannot read stripe_prices.stripe_price_id or any amount column
select 'anon reads nothing in credit_prices, credit_view_prices, stripe_prices' as check_name,
       not exists (select 1 from information_schema.column_privileges p
                    where p.grantee = 'anon' and p.table_schema = 'public' and p.privilege_type = 'SELECT'
                      and p.table_name in ('credit_prices', 'credit_view_prices', 'stripe_prices')) as ok
union all
select 'signed-in people cannot read credit_prices.price_cents',
       not has_column_privilege('authenticated', 'public.credit_prices', 'price_cents', 'select')
union all
select 'signed-in people still read credit_prices.credits',
       has_column_privilege('authenticated', 'public.credit_prices', 'credits', 'select')
union all
select 'signed-in people cannot read stripe_prices.stripe_price_id',
       not has_column_privilege('authenticated', 'public.stripe_prices', 'stripe_price_id', 'select');

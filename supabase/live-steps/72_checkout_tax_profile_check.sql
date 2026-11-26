-- BEFORE and AFTER 20261123000900_checkout_tax_profile.sql (the business-or-personal question and the plan-only Ohio tax at checkout): ONE read-only SELECT, changes nothing, never errors, prints no person's answer. Every column is named.
-- BEFORE the migration: rows 1 to 5 are FALSE and row 6 is true. AFTER it all six are true. The tax tables are EMPTY after the migration and stay empty until the Ohio rates are loaded (that is a later step: its own check says how many rows).
select 'the answer table exists, is closed to every API role, and a person can reach it only through the two functions' as check_name,
       coalesce(to_regclass('public.account_tax_profile') is not null
         and not has_table_privilege('anon', to_regclass('public.account_tax_profile'), 'select')
         and not has_table_privilege('authenticated', to_regclass('public.account_tax_profile'), 'select')
         and not has_table_privilege('service_role', to_regclass('public.account_tax_profile'), 'select'), false) as ok
union all select 'the three tax tables exist and are closed to every API role',
       coalesce(to_regclass('public.tax_rates') is not null and to_regclass('public.ohio_county_rate') is not null and to_regclass('public.ohio_zip_county') is not null
         and not has_table_privilege('anon', to_regclass('public.tax_rates'), 'select') and not has_table_privilege('authenticated', to_regclass('public.tax_rates'), 'select')
         and not has_table_privilege('authenticated', to_regclass('public.ohio_county_rate'), 'select') and not has_table_privilege('authenticated', to_regclass('public.ohio_zip_county'), 'select')
         and not has_table_privilege('service_role', to_regclass('public.ohio_zip_county'), 'select'), false)
union all select 'a signed-in person can run my_tax_profile and set_my_tax_profile; nobody anonymous can (and the county pre-fill read)',
       coalesce(has_function_privilege('authenticated', to_regprocedure('public.my_tax_profile()'), 'execute')
         and has_function_privilege('authenticated', to_regprocedure('public.set_my_tax_profile(text,text,text,text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.my_tax_profile()'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.set_my_tax_profile(text,text,text,text,text)'), 'execute')
         and has_function_privilege('authenticated', to_regprocedure('public.ohio_counties_for_zip(text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.ohio_counties_for_zip(text)'), 'execute'), false)
union all select 'the checkout context gives the four tax keys and still gives every key it had',
       coalesce(pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''tax_profile''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''tax_rate_id''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''tax_county''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''tax_unknown''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''buying_open''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%''is_admin''%', false)
union all select 'only a monthly plan, for business use in Ohio, is taxed (a pack never is)',
       coalesce(pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%v_mode = ''subscription''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%prof.use = ''business''%'
         and pg_get_functiondef(to_regprocedure('public.stripe_checkout_context(uuid,text)')) like '%prof.state = ''OH''%', false)
union all select 'the checkout context is still closed to the public, the signed-in and anonymous roles (the checkout function reads it with its own key)',
       coalesce(not has_function_privilege('anon', to_regprocedure('public.stripe_checkout_context(uuid,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.stripe_checkout_context(uuid,text)'), 'execute')
         and has_function_privilege('service_role', to_regprocedure('public.stripe_checkout_context(uuid,text)'), 'execute'), false);

-- OWNER-ONLY TEST CREDIT TOP-UP, THE CHECK (after supabase/migrations/20261127000100_owner_test_topup.sql). ONE read-only SELECT: changes nothing, never errors, prints no address.
-- Row 1 says PASS when rows 2 to 7 are all true, STOP otherwise (then tell CC1 and paste supabase/rollbacks/20261127000100_owner_test_topup_rollback.sql).
-- BEFORE the migration row 1 says STOP and rows 3 to 6 are false: that is expected. Step 78 counts the accounts on the list.
with c as (
select 2 as n, 'the credits ledger is live: grant_credits, adjust_credits and pool_balance exist (the top-up moves credits only through them)' as check_name,
       to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is not null
       and to_regprocedure('public.adjust_credits(uuid,public.credit_pool,integer,text,text)') is not null
       and to_regprocedure('ryagram_private.pool_balance(uuid,public.credit_pool)') is not null as ok
union all select 3, 'the owner list and the log exist and are closed to every API role (anonymous, signed in, service)',
       coalesce(to_regclass('ryagram_private.test_topup_accounts') is not null and to_regclass('ryagram_private.test_topups') is not null
         and not has_table_privilege('anon', to_regclass('ryagram_private.test_topup_accounts'), 'select') and not has_table_privilege('authenticated', to_regclass('ryagram_private.test_topup_accounts'), 'insert')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.test_topup_accounts'), 'select') and not has_table_privilege('service_role', to_regclass('ryagram_private.test_topup_accounts'), 'insert')
         and not has_table_privilege('anon', to_regclass('ryagram_private.test_topups'), 'select') and not has_table_privilege('authenticated', to_regclass('ryagram_private.test_topups'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.test_topups'), 'select'), false)
union all select 4, 'the three calls exist, a signed-in person can reach them, anonymous and the service key cannot',
       coalesce(to_regprocedure('public.admin_test_topup(text,integer,text)') is not null and to_regprocedure('public.admin_test_topup_undo(bigint,text)') is not null
         and to_regprocedure('public.admin_test_topup_list()') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.admin_test_topup(text,integer,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_test_topup(text,integer,text)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.admin_test_topup(text,integer,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_test_topup_undo(bigint,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_test_topup_list()'), 'execute'), false)
union all select 5, 'each call lets only an admin in the app through (require_admin) and the waiting gate guards it (require_active)',
       coalesce((select bool_and(p.prosrc like '%ryagram_private.require_admin()%' and p.prosrc like '%perform ryagram_private.require_active()%') and count(*) = 3
                   from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                  where s.nspname = 'public' and p.proname in ('admin_test_topup', 'admin_test_topup_undo', 'admin_test_topup_list')), false)
union all select 6, 'the top-up gives only to an account on the owner list, only through grant_credits, 1 to 100 at a time and 200 a day, and the undo takes back only through adjust_credits',
       coalesce(pg_get_functiondef(to_regprocedure('public.admin_test_topup(text,integer,text)')) like '%from ryagram_private.test_topup_accounts a%'
         and pg_get_functiondef(to_regprocedure('public.admin_test_topup(text,integer,text)')) like '%public.grant_credits(target, ''grant''%'
         and pg_get_functiondef(to_regprocedure('public.admin_test_topup(text,integer,text)')) like '%not between 1 and 100%'
         and pg_get_functiondef(to_regprocedure('public.admin_test_topup(text,integer,text)')) like '%> 200 then%'
         and pg_get_functiondef(to_regprocedure('public.admin_test_topup_undo(bigint,text)')) like '%public.adjust_credits(t.owner_id, ''granted'', -back%'
         and pg_get_functiondef(to_regprocedure('public.admin_test_topup_undo(bigint,text)')) like '%least(t.credits, left_over)%', false)
union all select 7, 'nothing else can write credits for a signed-in person: grant_credits and adjust_credits are still closed to anonymous and signed-in people',
       coalesce(not has_function_privilege('anon', to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.adjust_credits(uuid,public.credit_pool,integer,text,text)'), 'execute'), false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: the test top-up is in and closed' else 'STOP: a row below is false' end as check_name, (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

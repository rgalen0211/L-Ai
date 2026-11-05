-- AFTER 20261104000100_waiting_accounts.sql (and 20261104000200_waiting_join.sql if you applied it): one SELECT, read-only. Every ok must be true.
-- Run it BEFORE and AFTER switching waiting accounts on (20_waiting_accounts_switch_on.sql); the first check says which one you are looking at.
-- The allowed list below must be the same as in ryagram_private.gate_apply(); if a check about functions or tables is false, run   select ryagram_private.gate_apply();   and this again.
select 'every account has a status row' as check_name,
       not exists (select 1 from auth.users u where not exists (select 1 from public.account_status s where s.user_id = u.id)) as ok
union all select 'every function a signed-in person can run has the waiting check (or is on the named list)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
                      and p.prosrc not like '%perform ryagram_private.require_active();%'
                      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                      and p.proname <> all (array['funnel_anon', 'record_visit', 'report_film_page', 'service_status', 'submit_support', 'funnel_attach_source', 'funnel_return_visit',
                                                  'is_app_admin', 'current_engine_commit', 'film_request_cost', 'my_access', 'account_gate_ok', 'connect_consent_check']))
union all select 'every table with a policy for signed-in people has the waiting policy (or is on the named list)',
       not exists (select 1 from pg_policies pc
                    where pc.schemaname in ('public', 'storage') and pc.permissive = 'PERMISSIVE' and ('authenticated' = any (pc.roles) or 'public' = any (pc.roles))
                      and pc.tablename <> all (array['account_settings', 'account_deletion_requests', 'ryagram_waitlist', 'account_status'])
                      and not exists (select 1 from pg_policies q where q.schemaname = pc.schemaname and q.tablename = pc.tablename and q.policyname = 'account_gate'))
union all select 'grant_credits holds a grant for a waiting account (needs the credits ledger applied; run gate_apply again if false)',
       coalesce((select p.prosrc like '%ryagram_private.hold_grant%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'grant_credits'), false)
union all select 'the AI connector still asks account_active (connect_person_ok and the consent page); true when the connector is not installed',
       coalesce((select p.prosrc like '%account_active%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ryagram_private' and p.proname = 'connect_person_ok'), true)
       and coalesce((select p.prosrc like '%account_active(me)%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'connect_consent_check'), true)
union all select 'nobody signed in can write account_status',
       not has_table_privilege('authenticated', 'public.account_status', 'insert') and not has_table_privilege('authenticated', 'public.account_status', 'update')
       and not has_table_privilege('authenticated', 'public.account_status', 'delete') and not has_table_privilege('anon', 'public.account_status', 'select')
union all select 'invite_claim and account_is_active are for the service role only',
       not has_function_privilege('authenticated', 'public.invite_claim(uuid,text,text)', 'execute') and has_function_privilege('service_role', 'public.invite_claim(uuid,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.account_is_active(uuid)', 'execute') and has_function_privilege('service_role', 'public.account_is_active(uuid)', 'execute')
union all select 'the switch is OFF right now (INFO: false here means it is already ON; both are fine, just know which)',
       not coalesce((select waiting_accounts from public.ops_settings limit 1), false);

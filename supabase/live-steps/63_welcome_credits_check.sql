-- BEFORE and AFTER 20261123000600_welcome_credits.sql (8 welcome credits at email verification, once per address ever): ONE read-only SELECT, changes nothing, never errors, prints no address. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2 to 6 are FALSE, rows 7 and 8 are true. AFTER it all eight are true. Row 8 only says the number of credits a verification gives now (the setting), and is always true.
select 'the credits ledger is live: public.grant_credits exists (the migration gives credits only through it)' as check_name,
       to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is not null as ok
union all select 'the setting ops_settings.welcome_credits exists, is not null, defaults to 8 and is between 0 and 100',
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'welcome_credits' and is_nullable = 'NO' and column_default = '8'), false)
       and coalesce(exists (select 1 from pg_constraint c where c.conrelid = 'public.ops_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%welcome_credits >= 0%' and pg_get_constraintdef(c.oid) like '%welcome_credits <= 100%'), false)
union all select 'the once-per-address table exists, keeps only a scrambled address (no user id, no foreign key) and is closed to every API role',
       coalesce(to_regclass('ryagram_private.welcome_credit_grants') is not null
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants' and column_name in ('email_hash', 'granted_at'))
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants')
         and not exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.welcome_credit_grants') and c.contype = 'f')
         and not has_table_privilege('anon', to_regclass('ryagram_private.welcome_credit_grants'), 'select') and not has_table_privilege('authenticated', to_regclass('ryagram_private.welcome_credit_grants'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.welcome_credit_grants'), 'select'), false)
union all select 'the trigger on new and newly verified accounts exists (insert, or update of email_confirmed_at)',
       coalesce(exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'welcome_credits_trg' and not t.tgisinternal
                         and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE OF email_confirmed_at%'), false)
union all select 'the function gives credits only through grant_credits, once per scrambled address, skips invite-code accounts, administrators and workers, and turns any error into a warning',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.grant_credits(%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%on conflict (email_hash) do nothing%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.invite_redemptions%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%exception when others%', false)
union all select 'nobody signed in, anonymous or the connector login can run the function',
       coalesce(to_regprocedure('ryagram_private.welcome_credits_on_verified()') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute'), false)
union all select 'the settings row is there and nobody signed in or anonymous can read or write it',
       (select count(*) = 1 from public.ops_settings)
       and not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'update')
union all select 'a verification gives ' || coalesce((select (to_jsonb(o) ->> 'welcome_credits') from public.ops_settings o limit 1), 'nothing: the migration is not applied') || ' credits now (the setting; 0 = off)', true;

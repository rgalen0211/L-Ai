-- BEFORE and AFTER 20261127001100_calibrate_earn.sql revision 3 (people help tune Ryagram and earn credits, behind the master switch ops_settings.calibrate_enabled and the per-account switch calibrate): ONE read-only SELECT, changes nothing, never errors, prints no address. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2 to 9 are FALSE. AFTER it rows 1 to 9 are true. Row 10 only counts accounts, items and held awards and says whether the master switch is on; it is always true.
select 'the credits ledger is live: public.grant_credits and public.adjust_credits exist (releases and undos go only through them)' as check_name,
       to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is not null
       and to_regprocedure('public.adjust_credits(uuid,public.credit_pool,integer,text,text)') is not null as ok
union all select 'the six page calls exist with the page contract arguments, return jsonb, are security definer with an empty search path, run the waiting gate first and need a person in the app (never a connector)',
       coalesce((select count(*) = 6 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.oid in (to_regprocedure('public.my_calibration_consent_get()'), to_regprocedure('public.my_calibration_consent_set(boolean,text)'),
                                  to_regprocedure('public.my_calibration_round_get()'), to_regprocedure('public.my_calibration_answer_set(text,text,text)'),
                                  to_regprocedure('public.my_calibration_earned_get()'), to_regprocedure('public.my_calibration_undo(uuid)'))
                    and p.prorettype = 'jsonb'::regtype and p.prosecdef and p.proconfig = array['search_path=""']
                    and p.prosrc like '%perform ryagram_private.require_active()%'
                    and (p.prosrc like '%calibrate_person()%' or p.prosrc like '%calibrate_refuse_connector()%')), false)
union all select 'anonymous, the service key and the connector cannot run the page calls, signed-in people can, and only the connector runs the status read',
       coalesce(to_regprocedure('public.my_calibration_answer_set(text,text,text)') is not null
         and not has_function_privilege('anon', to_regprocedure('public.my_calibration_answer_set(text,text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.my_calibration_round_get()'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.my_calibration_answer_set(text,text,text)'), 'execute')
         and has_function_privilege('authenticated', to_regprocedure('public.my_calibration_answer_set(text,text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_calibration_status(text)'), 'execute')
         and (not exists (select 1 from pg_roles where rolname = 'connect_runner')
              or (not has_function_privilege('connect_runner', to_regprocedure('public.my_calibration_answer_set(text,text,text)'), 'execute')
                  and not has_function_privilege('connect_runner', to_regprocedure('public.my_calibration_consent_set(boolean,text)'), 'execute')
                  and not has_function_privilege('connect_runner', to_regprocedure('public.my_calibration_round_get()'), 'execute')
                  and has_function_privilege('connect_runner', to_regprocedure('public.connect_calibration_status(text)'), 'execute'))), false)
union all select 'the items, gold answers, round contents, media handles, consent words, rules, task kinds, points and budget are closed to every API role',
       coalesce(to_regclass('ryagram_private.calibrate_items') is not null
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_items'), 'select')
         and not has_table_privilege('anon', to_regclass('ryagram_private.calibrate_items'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.calibrate_items'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_round_items'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_media_handles'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_consent_words'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_rules'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_task_kinds'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_points'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.calibrate_budget'), 'select'), false)
union all select 'an item can only be own_app (opaque loc_ references, never gold), public domain or licensed, and carries a cleared status (only cleared items are served)',
       coalesce(exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.calibrate_items') and c.contype = 'c'
                         and pg_get_constraintdef(c.oid) like '%own_app%' and pg_get_constraintdef(c.oid) like '%public_domain%' and pg_get_constraintdef(c.oid) like '%licensed%')
                and exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.calibrate_items') and c.contype = 'c'
                         and pg_get_constraintdef(c.oid) like '%loc_%' and pg_get_constraintdef(c.oid) like '%is_gold%')
                and exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.calibrate_items') and c.contype = 'c'
                         and pg_get_constraintdef(c.oid) like '%cleared%'), false)
union all select 'the six person tables have row security on and the account gate, and NO grant to any API role (a round result is never readable directly), and the award tables are append-only',
       coalesce((select count(*) = 6 from pg_class t join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'public' and t.relname in ('calibrate_consents', 'calibrate_rounds', 'calibrate_answers', 'calibrate_awards', 'calibrate_releases', 'calibrate_credit_moves')
                    and t.relrowsecurity
                    and exists (select 1 from pg_policies q where q.schemaname = 'public' and q.tablename = t.relname and q.policyname = 'account_gate')
                    and not has_table_privilege('authenticated', t.oid, 'select') and not has_table_privilege('authenticated', t.oid, 'insert')
                    and not has_table_privilege('authenticated', t.oid, 'update') and not has_table_privilege('authenticated', t.oid, 'delete')
                    and not has_table_privilege('anon', t.oid, 'select'))
                and (select count(*) = 3 from pg_trigger g where not g.tgisinternal and g.tgname in ('calibrate_awards_append_only', 'calibrate_releases_append_only', 'calibrate_credit_moves_append_only')), false)
union all select 'the dashboard undo, the release tick and the cancel are closed to every API role',
       coalesce(to_regprocedure('ryagram_private.calibrate_award_undo(bigint,text)') is not null
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.calibrate_award_undo(bigint,text)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('ryagram_private.calibrate_award_undo(bigint,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.calibrate_release_due()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.calibrate_release_owner(uuid)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.calibrate_cancel_held(uuid,text)'), 'execute'), false)
union all select 'the master switch exists: ops_settings.calibrate_enabled, off unless Ryan turns it on',
       exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'ops_settings' and c.column_name = 'calibrate_enabled'
                and c.column_default = 'false' and c.is_nullable = 'NO')
union all select 'every calibrate credit move has exactly one ledger row of the same amount (none yet is fine)',
       coalesce((select substring(query_to_xml('select count(*) as n from public.calibrate_credit_moves m where (select count(*) from public.credit_ledger l where l.id = m.ledger_id and l.owner_id = m.owner_id and l.amount = m.credits and l.entry in (''grant'', ''adjustment'')) <> 1', false, true, '')::text from '<n>([^<]*)</n>') = '0'
                  where to_regclass('public.calibrate_credit_moves') is not null), false)
union all select 'accounts with the calibrate switch on: ' || (select count(*) from public.account_settings s where 'calibrate' = any (s.switches_on))
       || ', master switch: ' || coalesce((select substring(query_to_xml('select calibrate_enabled::text as v from public.ops_settings limit 1', false, true, '')::text from '<v>([^<]*)</v>')
                                            where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'ops_settings' and c.column_name = 'calibrate_enabled')), 'none (not applied)')
       || ', items loaded: ' || coalesce((select substring(query_to_xml('select count(*) as n from ryagram_private.calibrate_items', false, true, '')::text from '<n>([^<]*)</n>')
                                           where to_regclass('ryagram_private.calibrate_items') is not null), 'none (not applied)')
       || ', awards held: ' || coalesce((select substring(query_to_xml('select count(*) as n from public.calibrate_awards w where w.kind = ''award'' and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id) and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id)', false, true, '')::text from '<n>([^<]*)</n>')
                                           where to_regclass('public.calibrate_awards') is not null), 'none (not applied)'), true;

-- AFTER 20261105000100_chat_editor.sql (the live editor inside the AI chat, Q436/Q449): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration it answers false rows, never an error. Every column is named; the rows that look at a function's text say which rule they prove.
select 'the five panel functions exist' as check_name,
       (select count(*) from unnest(array['public.connect_editor_apply(text,uuid,text,bigint,jsonb)', 'public.connect_editor_undo(text,uuid,text,bigint)', 'public.connect_editor_undo_ai(text,uuid,text)',
                                          'public.connect_editor_since(text,uuid,text,bigint)', 'public.connect_editor_heartbeat(text,uuid,text)']) f
         where to_regprocedure(f) is not null) = 5 as ok
union all select 'the five panel functions are security definer with an empty search path, and none belongs to an API role or to the connector login',
       (select count(*) from pg_proc p where p.oid in (select to_regprocedure(f) from unnest(array['public.connect_editor_apply(text,uuid,text,bigint,jsonb)', 'public.connect_editor_undo(text,uuid,text,bigint)',
                                                                                                     'public.connect_editor_undo_ai(text,uuid,text)', 'public.connect_editor_since(text,uuid,text,bigint)', 'public.connect_editor_heartbeat(text,uuid,text)']) f)
          and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
          and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')) = 5
union all select 'ONLY the connector login can run the five panel functions: not signed-in people, not the public, not the service role, not the computer login',
       (select count(*) from unnest(array['public.connect_editor_apply(text,uuid,text,bigint,jsonb)', 'public.connect_editor_undo(text,uuid,text,bigint)', 'public.connect_editor_undo_ai(text,uuid,text)',
                                          'public.connect_editor_since(text,uuid,text,bigint)', 'public.connect_editor_heartbeat(text,uuid,text)']) f
         where to_regprocedure(f) is not null
           and has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
           and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')
           and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure(f) and x.grantee = 0 and x.privilege_type = 'EXECUTE')) = 5
union all select 'the two private helpers exist (the fixed label and the gate every panel call runs) and nobody can run them directly',
       (select count(*) from unnest(array['ryagram_private.chat_editor_label()', 'ryagram_private.chat_editor_gate(uuid,uuid,text)']) f
         where to_regprocedure(f) is not null and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
           and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 2
union all select 'the panel label is exactly "Ryagram panel"',
       coalesce((select p.prosrc like '%''Ryagram panel''::text%' and length(p.prosrc) < 80 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ryagram_private' and p.proname = 'chat_editor_label'), false)
union all select 'a panel change is recorded as the AI side, under the fixed label, never one the caller names',
       coalesce((select p.prosrc like '%apply_edit_ops(me, p_project, p_mode, p_base_revision, ''ai'', ryagram_private.chat_editor_label(), p_ops)%' from pg_proc p where p.oid = to_regprocedure('public.connect_editor_apply(text,uuid,text,bigint,jsonb)')), false)
union all select 'the panel''s undo of one change takes back only the AI side''s own changes and only the person''s own project',
       coalesce((select p.prosrc like '%e.owner_id = me%' and p.prosrc like '%e.actor = ''ai''%' from pg_proc p where p.oid = to_regprocedure('public.connect_editor_undo(text,uuid,text,bigint)')), false)
union all select 'the panel''s Undo all skips every change labelled "Ryagram panel" (a click of the person''s own)',
       coalesce((select p.prosrc like '%client_label is distinct from ryagram_private.chat_editor_label()%' from pg_proc p where p.oid = to_regprocedure('public.connect_editor_undo_ai(text,uuid,text)')), false)
union all select 'the website''s Undo my AI''s changes (editor_undo_all_ai) skips every change labelled "Ryagram panel"',
       coalesce((select p.prosrc like '%client_label is distinct from ryagram_private.chat_editor_label()%' from pg_proc p where p.oid = to_regprocedure('public.editor_undo_all_ai(uuid,text)')), false)
union all select 'the AI''s own undo (connect_edit_undo_ai) skips panel changes both when it picks the changes and when it finds its latest batch',
       coalesce((select (length(p.prosrc) - length(replace(p.prosrc, 'client_label is distinct from ryagram_private.chat_editor_label()', ''))) / length('client_label is distinct from ryagram_private.chat_editor_label()') >= 2
                   from pg_proc p where p.oid = to_regprocedure('public.connect_edit_undo_ai(text,uuid,text)')), false)
union all select 'the AI''s own change call (connect_edit_ops) renames a client called "Ryagram panel", so no connector client can label its own change as a click',
       coalesce((select p.prosrc like '%lower(ryagram_private.chat_editor_label())%' and p.prosrc like '%AI client (renamed)%' from pg_proc p where p.oid = to_regprocedure('public.connect_edit_ops(text,uuid,text,bigint,jsonb)')), false)
union all select 'the website''s Undo my AI''s changes still asks the waiting-list check (the migration ends with the waiting-list gate)',
       coalesce((select p.prosrc like '%perform ryagram_private.require_active();%' from pg_proc p where p.oid = to_regprocedure('public.editor_undo_all_ai(uuid,text)')), false)
union all select 'every function a signed-in person can run still has the waiting check (or is on the named list)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
                      and p.prosrc not like '%perform ryagram_private.require_active();%'
                      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                      and p.proname <> all (array['funnel_anon', 'record_visit', 'report_film_page', 'service_status', 'submit_support', 'funnel_attach_source', 'funnel_return_visit',
                                                  'is_app_admin', 'current_engine_commit', 'film_request_cost', 'my_access', 'account_gate_ok', 'connect_consent_check']))
union all select 'nothing else changed: the website''s other four editor functions are still for signed-in people only, and the AI''s three older connector functions are still for the connector login only',
       (select count(*) from unnest(array['public.editor_apply_ops(uuid,text,bigint,jsonb)', 'public.editor_undo(uuid,text,bigint)', 'public.editor_undo_all_ai(uuid,text)', 'public.my_edit_ops_since(uuid,text,bigint)', 'public.editor_heartbeat(uuid,text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute')) = 5
       and (select count(*) from unnest(array['public.connect_edit_state(text,uuid)', 'public.connect_edit_ops(text,uuid,text,bigint,jsonb)', 'public.connect_edit_undo_ai(text,uuid,text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
           and not has_function_privilege('service_role', f, 'execute')) = 3
union all select 'nothing else changed: the drafts, their log and the look-key list are still untouchable for every API role and the connector login (the panel works only through the functions above)',
       not has_table_privilege('authenticated', 'public.edit_drafts', 'select,insert,update,delete') and not has_table_privilege('anon', 'public.edit_drafts', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.edit_drafts', 'select,insert,update,delete') and not has_table_privilege('connect_runner', 'public.edit_drafts', 'select,insert,update,delete')
       and not has_table_privilege('anon', 'public.edit_ops', 'select,insert,update,delete') and not has_table_privilege('service_role', 'public.edit_ops', 'select,insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.edit_ops', 'select,insert,update,delete') and not has_table_privilege('authenticated', 'public.edit_ops', 'insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.edit_look_keys', 'select,insert,update,delete')
union all select 'no private helper beyond the two carries the panel''s name (nothing extra was added)',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ryagram_private' and p.proname like 'chat\_editor\_%') = 2;

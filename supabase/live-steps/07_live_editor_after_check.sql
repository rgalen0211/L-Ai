-- AFTER 20261027000400_live_editor.sql (the live preview editor, AI half): one SELECT, read-only. Every ok must be true.
select 'the three tables exist with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid in ('public.edit_drafts'::regclass, 'public.edit_ops'::regclass, 'public.edit_look_keys'::regclass) and c.relrowsecurity) = 3 as ok
union all select 'the drafts and the look-key list are untouchable (nobody can touch them directly: not signed-in people, not the public, not the service role, not the connector or the app login)',
       not has_table_privilege('authenticated', 'public.edit_drafts', 'select,insert,update,delete') and not has_table_privilege('anon', 'public.edit_drafts', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.edit_drafts', 'select,insert,update,delete') and not has_table_privilege('connect_runner', 'public.edit_drafts', 'select,insert,update,delete')
       and not has_table_privilege('node_runner', 'public.edit_drafts', 'select,insert,update,delete')
       and not has_table_privilege('authenticated', 'public.edit_look_keys', 'select,insert,update,delete') and not has_table_privilege('connect_runner', 'public.edit_look_keys', 'select,insert,update,delete')
union all select 'people can READ their own log and write nothing in it; nobody else has any access to it',
       has_table_privilege('authenticated', 'public.edit_ops', 'select') and not has_table_privilege('authenticated', 'public.edit_ops', 'insert,update,delete')
       and not has_table_privilege('anon', 'public.edit_ops', 'select,insert,update,delete') and not has_table_privilege('service_role', 'public.edit_ops', 'select,insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.edit_ops', 'select,insert,update,delete') and not has_table_privilege('node_runner', 'public.edit_ops', 'select,insert,update,delete')
union all select 'the three connector functions exist and ONLY the connector login can run them',
       (select count(*) from unnest(array['public.connect_edit_state(text,uuid)', 'public.connect_edit_ops(text,uuid,text,bigint,jsonb)', 'public.connect_edit_undo_ai(text,uuid,text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 3
union all select 'the five editor functions exist for signed-in people and not for the public or the connector',
       (select count(*) from unnest(array['public.editor_apply_ops(uuid,text,bigint,jsonb)', 'public.editor_undo(uuid,text,bigint)', 'public.editor_undo_all_ai(uuid,text)',
                                          'public.my_edit_ops_since(uuid,text,bigint)', 'public.editor_heartbeat(uuid,text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
           and not has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 5
union all select 'the two desktop-app functions exist and ONLY the signed-in computer login can run them',
       (select count(*) from unnest(array['public.node_edit_pending(text)', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)']) f
         where to_regprocedure(f) is not null and has_function_privilege('node_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute')) = 2
union all select 'the engine of the drafts (apply, undo, the vocabulary check, the purge) is private: nobody can run it directly',
       (select count(*) from unnest(array['ryagram_private.apply_edit_ops(uuid,uuid,text,bigint,text,text,jsonb)', 'ryagram_private.undo_edit_ops(uuid,uuid,text,bigint[],text)',
                                          'ryagram_private.edit_op_problem(text,jsonb)', 'ryagram_private.edit_text_ok(text,integer)', 'ryagram_private.edit_purge()']) f
         where to_regprocedure(f) is not null and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
           and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 5
union all select 'the consent page now offers the new scope "edit" next to read, write and render_free',
       ryagram_private.connect_offered_scopes() @> array['read', 'write', 'render_free', 'edit']
union all select 'the look-key list holds the nine keys the worker accepts today and no draft or log row exists yet',
       (select count(*) from public.edit_look_keys) >= 9 and (select count(*) from public.edit_drafts) = 0 and (select count(*) from public.edit_ops) = 0;

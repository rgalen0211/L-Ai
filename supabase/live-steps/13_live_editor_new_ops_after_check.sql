-- AFTER 20261029000100_live_editor_new_ops.sql (the live editor's five new changes and the richer track summary): one SELECT, read-only. Every ok must be true.
select 'the five new changes are known (each one, well formed, is accepted)' as check_name,
       ryagram_private.edit_op_problem('compilation', '{"op": "set_clip_style", "id": "c1", "style": "title"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_music", "level_db": -6}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_rule", "phrase": "touchdown", "picture": "cheer.png", "seconds": 2, "mode": "corner"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "delete_rule", "id": "r1"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "theme", "value": "light"}'::jsonb) is null as ok
union all select 'and still refused in words when a value is wrong (a style, a music level, a look key)',
       ryagram_private.edit_op_problem('compilation', '{"op": "set_clip_style", "id": "c1", "style": "huge"}'::jsonb) is not null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_music", "level_db": 40}'::jsonb) is not null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "font", "value": "x"}'::jsonb) is not null
union all select 'a change nobody knows is still refused',
       ryagram_private.edit_op_problem('compilation', '{"op": "run_anything"}'::jsonb) is not null
union all select 'the two changed functions kept their owners: only the signed-in computer login runs the summary, and nobody runs the rule check directly',
       has_function_privilege('node_runner', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('connect_runner', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and not has_function_privilege('anon', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and not has_function_privilege('connect_runner', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute');

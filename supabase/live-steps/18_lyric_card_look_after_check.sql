-- AFTER 20261031000200_lyric_card_look.sql (the lyric card setting): one SELECT, read-only. Every ok must be true.
select 'a lyric card design is accepted' as check_name,
       ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "lyric_card", "value": "plate"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "lyric_card", "value": "bar"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "lyric_card", "value": "sing_along"}'::jsonb) is null as ok
union all select 'a design that does not exist is refused in words',
       coalesce(ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "lyric_card", "value": "neon"}'::jsonb) like '%plate, bar, sing_along%', false)
union all select 'the other film look settings still work and a made-up one is still refused',
       ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "theme", "value": "light"}'::jsonb) is null
       and ryagram_private.edit_op_problem('compilation', '{"op": "set_film_look", "key": "font", "value": "x"}'::jsonb) is not null
union all select 'the two functions kept their owners: nobody but the editor functions runs the rule check directly, and only the signed-in computer login runs the summary',
       not has_function_privilege('authenticated', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and not has_function_privilege('anon', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and has_function_privilege('node_runner', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)', 'execute');

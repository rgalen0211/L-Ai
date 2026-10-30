-- AFTER 20261030000200_live_editor_leadin.sql (more lead-in on the first video clip): one SELECT, read-only. Every ok must be true.
select 'a start trim with a negative `to` (more lead-in) is accepted' as check_name,
       ryagram_private.edit_op_problem('compilation', '{"op": "trim_clip", "id": "v1", "edge": "start", "to": -1}'::jsonb) is null as ok
union all select 'but not below -3600, and the words say the range',
       ryagram_private.edit_op_problem('compilation', '{"op": "trim_clip", "id": "v1", "edge": "start", "to": -3601}'::jsonb) like '%between -3600 and 86400%'
union all select 'the END edge still refuses a negative `to`, in the old words',
       ryagram_private.edit_op_problem('compilation', '{"op": "trim_clip", "id": "v1", "edge": "end", "to": -2}'::jsonb) like '%between 0 and 86400%'
union all select 'a start trim above 86400 is still refused',
       ryagram_private.edit_op_problem('compilation', '{"op": "trim_clip", "id": "v1", "edge": "start", "to": 86401}'::jsonb) is not null
union all select 'the function kept its owner: nobody but the editor functions runs the rule check directly',
       not has_function_privilege('authenticated', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and not has_function_privilege('anon', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')
       and not has_function_privilege('connect_runner', 'ryagram_private.edit_op_problem(text,jsonb)', 'execute');

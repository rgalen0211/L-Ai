-- AFTER 20261030000200_footage_plans.sql (footage plans, NEXT-CONNECT 168 P1b): one SELECT, read-only. Every ok must be true.
select 'the table exists with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid = 'public.footage_plans'::regclass and c.relrowsecurity) = 1 as ok
union all select 'the plans are untouchable directly (signed-in people may only READ their own; the public, the service role, the connector and the app login have no access)',
       has_table_privilege('authenticated', 'public.footage_plans', 'select') and not has_table_privilege('authenticated', 'public.footage_plans', 'insert,update,delete')
       and not has_table_privilege('anon', 'public.footage_plans', 'select,insert,update,delete') and not has_table_privilege('service_role', 'public.footage_plans', 'select,insert,update,delete')
       and not has_table_privilege('connect_runner', 'public.footage_plans', 'select,insert,update,delete') and not has_table_privilege('node_runner', 'public.footage_plans', 'select,insert,update,delete')
union all select 'the two connector functions exist and ONLY the connector login can run them',
       (select count(*) from unnest(array['public.connect_request_footage(text,text,text,text)', 'public.connect_list_footage(text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('connect_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('node_runner', f, 'execute')) = 2
union all select 'the two desktop-app functions exist and ONLY the signed-in computer login can run them',
       (select count(*) from unnest(array['public.node_footage_plans(text)', 'public.node_footage_update(text,uuid,text,jsonb)']) f
         where to_regprocedure(f) is not null and has_function_privilege('node_runner', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
           and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('connect_runner', f, 'execute')) = 2
union all select 'the switch reader exists and nobody but the database owner can run it',
       to_regprocedure('ryagram_private.footage_on()') is not null
       and not has_function_privilege('connect_runner', 'ryagram_private.footage_on()', 'execute') and not has_function_privilege('node_runner', 'ryagram_private.footage_on()', 'execute')
       and not has_function_privilege('authenticated', 'ryagram_private.footage_on()', 'execute') and not has_function_privilege('anon', 'ryagram_private.footage_on()', 'execute')
union all select 'THE SWITCH IS OFF (footage_enabled is false): the AI cannot write a footage plan',
       (select count(*) from public.connect_flags where footage_enabled is false) = (select count(*) from public.connect_flags) and not ryagram_private.footage_on()
union all select 'no plan exists yet',
       (select count(*) from public.footage_plans) = 0;

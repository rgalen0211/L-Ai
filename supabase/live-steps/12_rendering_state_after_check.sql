-- AFTER 20261027001100_connect_rendering_state.sql (Q307, the render machine's state for the connected AI): one SELECT, read-only. Every ok must be true.
select 'the function exists' as check_name, to_regprocedure('public.connect_rendering_state(text)') is not null as ok
union all select 'ONLY the connector login can run it (not signed-in people, not the public, not the service role)',
       has_function_privilege('connect_runner', 'public.connect_rendering_state(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.connect_rendering_state(text)', 'execute')
       and not has_function_privilege('anon', 'public.connect_rendering_state(text)', 'execute')
       and not has_function_privilege('service_role', 'public.connect_rendering_state(text)', 'execute')
union all select 'the state it reads exists and is one of the three words ok, delayed, unknown',
       ryagram_private.service_state() in ('ok', 'delayed', 'unknown');

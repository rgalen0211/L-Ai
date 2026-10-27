-- AFTER Q247 B (20261026000400_node_compilation_requests.sql): one SELECT, read-only. Every ok must be true. (Needs Q246 B applied first: the function reads that table.)
select 'node_compilation_requests exists and ONLY the node login can run it' as check_name,
       to_regprocedure('public.node_compilation_requests(text)') is not null
       and has_function_privilege('node_runner', 'public.node_compilation_requests(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.node_compilation_requests(text)', 'execute')
       and not has_function_privilege('anon', 'public.node_compilation_requests(text)', 'execute')
       and not has_function_privilege('service_role', 'public.node_compilation_requests(text)', 'execute') as ok
union all select 'the table it reads (Q246) is there',
       to_regclass('public.compilation_requests') is not null;

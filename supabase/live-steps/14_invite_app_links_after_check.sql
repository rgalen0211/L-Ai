-- AFTER 20261030000100_invite_app_links.sql (NEXT-CONNECT 162, the app link in the invite email): one SELECT, read-only. Every ok must be true.
select 'the table invite_app_links exists with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid = 'public.invite_app_links'::regclass and c.relrowsecurity) = 1 as ok
union all select 'nobody can touch the table directly (not signed-in people, not the public, not the service role)',
       not has_table_privilege('authenticated', 'public.invite_app_links', 'select,insert,update,delete') and not has_table_privilege('anon', 'public.invite_app_links', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.invite_app_links', 'select,insert,update,delete')
union all select 'the admin function exists; signed-in sessions can call it (it refuses everyone who is not an administrator), the public cannot',
       to_regprocedure('public.admin_invite_app_link_make(text)') is not null and has_function_privilege('authenticated', 'public.admin_invite_app_link_make(text)', 'execute')
       and not has_function_privilege('anon', 'public.admin_invite_app_link_make(text)', 'execute')
union all select 'peek and redeem exist and ONLY the service role can run them',
       (select count(*) from unnest(array['public.peek_invite_app_link(text)', 'public.redeem_invite_app_link(text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('service_role', f, 'execute')
           and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 2
union all select 'no link exists yet (nothing was made by applying it)', (select count(*) from public.invite_app_links) = 0;

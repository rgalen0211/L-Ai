-- AFTER 20261027000900_connect_access_admin.sql (Q301 B, the Connect-an-AI per-account switch on the admin page): one SELECT, read-only. Every ok must be true.
select 'the audit table exists with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid = 'public.connect_access_audit'::regclass and c.relrowsecurity) = 1 as ok
union all select 'nobody can touch the audit table directly (not signed-in people, not the public, not the service role)',
       not has_table_privilege('authenticated', 'public.connect_access_audit', 'select,insert,update,delete') and not has_table_privilege('anon', 'public.connect_access_audit', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.connect_access_audit', 'select,insert,update,delete')
union all select 'the three admin functions exist; signed-in sessions can call them (they refuse everyone who is not an administrator), the public cannot',
       (select count(*) from unnest(array['public.admin_connect_access_set(text,boolean,text)', 'public.admin_connect_access_audit()', 'public.admin_connect_access_list()']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 3
union all select 'nothing was switched by applying it (the audit table is empty)',
       (select count(*) from public.connect_access_audit) = 0;

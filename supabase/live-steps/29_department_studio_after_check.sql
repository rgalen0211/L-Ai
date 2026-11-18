-- AFTER 20261118000100_department_studio.sql (the Studio row): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the Studio rows answer false, never an error. Every column is named.
select 'the studio row exists: label Studio, status soon, no local-compute need, sort 60' as check_name,
       coalesce((select d.label = 'Studio' and d.status = 'soon' and d.needs_local_compute = false and d.sort = 60 from public.departments d where d.id = 'studio'), false) as ok
union all select 'it is the only studio row and it comes last in the order',
       coalesce((select count(*) = 1 and bool_and(true) from public.departments d where d.id = 'studio'), false)
         and coalesce((select (array_agg(d.id order by d.sort, d.id))[count(*)] = 'studio' from public.departments d), false)
union all select 'the five departments that were there are still there with their own ids and sort numbers',
       coalesce((select array_agg(d.id order by d.sort, d.id) = array['data_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio'] from public.departments d where d.id <> 'studio'), false)
union all select 'Studio is not promoted: it is soon, so nothing opens (only a person promoting it later changes that)',
       coalesce((select d.status = 'soon' from public.departments d where d.id = 'studio'), false)
union all select 'the departments table is still closed to every API role',
       not (has_table_privilege('anon', 'public.departments', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.departments', 'select, insert, update, delete')
            or has_table_privilege('service_role', 'public.departments', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.departments', 'select, insert, update, delete'))
union all select 'nothing is wired to send anything about departments (no trigger on the two tables)',
       not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('departments', 'department_interest') and not t.tgisinternal);

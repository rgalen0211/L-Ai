-- AFTER 20261113000300_film_bundle_types.sql and 20261113000400_film_bundles.sql (the editor's real-frame bundles): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after part 2. Before it the rows answer false, never an error. Every column is named.
select 'the job types and artifact kinds exist (film_bundle, and scene_bundle which the worker contract names)' as check_name,
       (select count(*) from pg_enum e where e.enumtypid = 'public.job_type'::regtype and e.enumlabel in ('film_bundle', 'scene_bundle')) = 2
       and (select count(*) from pg_enum e where e.enumtypid = 'public.artifact_kind'::regtype and e.enumlabel in ('film_bundle', 'scene_bundle')) = 2 as ok
union all select 'a film bundle is one file, film.bundle.zip, at most 50 MB, and the job may also write its metering',
       coalesce((select f.filename = 'film.bundle.zip' and f.mime = 'application/zip' and f.max_bytes = 50000000 from ryagram_private.artifact_file('film_bundle'::public.artifact_kind) f), false)
       and coalesce(ryagram_private.kind_allowed('film_bundle'::public.job_type, 'film_bundle'::public.artifact_kind), false)
       and coalesce(ryagram_private.kind_allowed('film_bundle'::public.job_type, 'metering'::public.artifact_kind), false)
       and not coalesce(ryagram_private.kind_allowed('film_bundle'::public.job_type, 'final_video'::public.artifact_kind), false)
       and ryagram_private.required_kinds('film_bundle'::public.job_type) = array['film_bundle']::public.artifact_kind[]
       and coalesce((select f.filename = 'scene.bundle.zip' and f.mime = 'application/zip' and f.max_bytes = 50000000 from ryagram_private.artifact_file('scene_bundle'::public.artifact_kind) f), false)
       and ryagram_private.kind_allowed('scene_bundle'::public.job_type, 'scene_bundle'::public.artifact_kind) and ryagram_private.required_kinds('scene_bundle'::public.job_type) = array['scene_bundle']::public.artifact_kind[]
union all select 'the bucket accepts a zip',
       coalesce((select 'application/zip' = any (b.allowed_mime_types) from storage.buckets b where b.id = 'ryagram-artifacts'), false)
union all select 'film bundles start switched OFF (control.disabled_job_types names film_bundle and scene_bundle) until Ryan turns them on',
       coalesce((select 'film_bundle' = any (c.disabled_job_types) and 'scene_bundle' = any (c.disabled_job_types) from public.control c where c.id), false)
union all select 'only request_film_bundle can make one (the guard trigger is on jobs)',
       exists (select 1 from pg_trigger t where t.tgrelid = 'public.jobs'::regclass and t.tgname = 'jobs_film_bundle_by_request' and not t.tgisinternal)
union all select 'request_film_bundle(uuid, text) exists, is security definer, runs for a signed-in person and not for a visitor, and carries the waiting-list guard',
       coalesce((select p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosrc like '%require_active%'
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.request_film_bundle(uuid,text)')), false)
union all select 'the window rule is in the function (whole seconds, A < B, at most 10)',
       coalesce((select p.prosrc like '%b - a > 10%' and p.prosrc like '%a >= b%' from pg_proc p where p.oid = to_regprocedure('public.request_film_bundle(uuid,text)')), false)
union all select 'the credits ledger (when it is on this database) prices a film bundle at 0 in both its functions and has the price row; where it is not on this database this row is true',
       case when to_regprocedure('ryagram_private.jobs_quote()') is null then true
            else coalesce((select p.prosrc like '%film_bundle%' from pg_proc p where p.oid = to_regprocedure('ryagram_private.jobs_quote()')), false)
                 and coalesce((select p.prosrc like '%film_bundle%' from pg_proc p where p.oid = to_regprocedure('public.credit_quote(uuid,public.job_type)')), false)
                 and (xpath('/row/c/text()', query_to_xml('select count(*) as c from (select distinct price_version from public.credit_prices) v where not exists (select 1 from public.credit_prices c where c.price_version = v.price_version and c.code = ''film_bundle'' and c.credits = 0)', false, true, '')))[1]::text::int = 0
       end;

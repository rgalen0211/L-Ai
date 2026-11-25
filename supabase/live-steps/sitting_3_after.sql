-- SITTING PASTE 3 of 3: every AFTER check of A1 to A19 (GEO sitting_build.py, Wed 11-25; generated: edit sitting_build.py, never this file). Read-only: one SELECT, changes nothing.
-- Copy ALL of this file into the Supabase SQL Editor and Run. Read ONLY the first row: PASS or STOP. On STOP, send GEO the rows below it.
with got as (
  select 0 as k, 'A1 after (step 30)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261120000100_connect_purge_edit.sql (the daily connector purge also runs the live editor's purge): one SELECT, read-only, changes nothing. Every ok must be true. NOT APPLIED; UNRUN against a database.
-- Run it on the same project right after the migration. Before the migration the first two rows answer false, never an error. Every column is named.
select 1 as geo_n, 'connect_purge exists with no arguments and returns jsonb' as check_name,
       coalesce((select pg_get_function_result(p.oid) = 'jsonb' from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false) as ok
union all select 2, 'connect_purge now runs the live editor''s purge (it names ryagram_private.edit_purge) and still answers its four counts',
       coalesce((select p.prosrc like '%ryagram_private.edit_purge()%' and p.prosrc like '%''requests'', a%' and p.prosrc like '%''calls'', d%' from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 3, 'connect_purge still deletes the same old rows (requests, codes, spent tokens, calls over 30 days, buckets, clients nobody signed in to)',
       coalesce((select p.prosrc like '%delete from public.connect_requests%' and p.prosrc like '%delete from public.connect_codes%' and p.prosrc like '%delete from public.connect_tokens%'
                   and p.prosrc like '%delete from public.connect_calls%' and p.prosrc like '%delete from public.connect_buckets%' and p.prosrc like '%delete from public.connect_clients%'
                 from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 4, 'connect_purge is still security definer with an empty search path, and belongs to no API role or connector login',
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner')
                 from pg_proc p where p.oid = to_regprocedure('public.connect_purge()')), false)
union all select 5, 'connect_purge is for the database owner and the dashboard only: not signed-in people, not the public, not the connector login, not the computer login (the service role keeps the platform''s default, as before)',
       coalesce((select not has_function_privilege('connect_runner', 'public.connect_purge()', 'execute') and not has_function_privilege('authenticated', 'public.connect_purge()', 'execute')
                   and not has_function_privilege('anon', 'public.connect_purge()', 'execute') and not has_function_privilege('node_runner', 'public.connect_purge()', 'execute')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure('public.connect_purge()') and x.grantee = 0 and x.privilege_type = 'EXECUTE')
                 where to_regprocedure('public.connect_purge()') is not null), false)
union all select 6, 'the live editor''s purge itself is still private (nobody can run it directly)',
       coalesce((select not has_function_privilege('authenticated', 'ryagram_private.edit_purge()', 'execute') and not has_function_privilege('anon', 'ryagram_private.edit_purge()', 'execute')
                   and not has_function_privilege('service_role', 'ryagram_private.edit_purge()', 'execute') and not has_function_privilege('connect_runner', 'ryagram_private.edit_purge()', 'execute')
                 where to_regprocedure('ryagram_private.edit_purge()') is not null), true)
  ) t
  union all
  select 1 as k, 'A2 after (step 31)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261120000200_plan_asks_lock_and_host.sql (one ask at a time per person for download and footage plans; a download host must be a real name): one SELECT, read-only, changes nothing. Every ok must be true. NOT APPLIED; UNRUN against a database.
-- Run it on the same project right after the migration. Before the migration the first four rows answer false, never an error. Every column is named. A project without the footage plans migration answers false in the footage rows only.
select 1 as geo_n, 'connect_request_download takes the per-person lock before it counts' as check_name,
       coalesce((select p.prosrc like '%pg_advisory_xact_lock(hashtextextended(''download:'' || me::text, 0))%'
                   and position('pg_advisory_xact_lock' in p.prosrc) < position('select count(*) into waiting' in p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false) as ok
union all select 2, 'connect_request_download refuses a host whose last label is not a name or whose last label is localhost, local, internal or lan',
       coalesce((select strpos(p.prosrc, 'host !~ ''\.[a-z][a-z0-9-]*$''') > 0 and strpos(p.prosrc, '(localhost|local|internal|lan)') > 0 from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false)
union all select 3, 'connect_request_download keeps its limits (5 waiting, 20 a day) and the scope fetch_data',
       coalesce((select p.prosrc like '%waiting >= 5%' and p.prosrc like '%today >= 20%' and p.prosrc like '%connect_actor(p_token_hash, ''fetch_data'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_request_download(text,text,text,text)')), false)
union all select 4, 'connect_request_footage takes the per-person lock before it looks for the same item and counts',
       coalesce((select p.prosrc like '%pg_advisory_xact_lock(hashtextextended(''footage:'' || me::text, 0))%'
                   and position('pg_advisory_xact_lock' in p.prosrc) < position('select * into same' in p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.connect_request_footage(text,text,text,text)')), false)
union all select 5, 'connect_request_footage still refuses while the switch is off and keeps its limits',
       coalesce((select p.prosrc like '%not ryagram_private.footage_on()%' and p.prosrc like '%waiting >= 5%' and p.prosrc like '%today >= 20%' from pg_proc p where p.oid = to_regprocedure('public.connect_request_footage(text,text,text,text)')), false)
union all select 6, 'both are still security definer with an empty search path, and belong to no API role or connector login',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'connect_runner', 'node_runner'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_request_download(text,text,text,text)'), to_regprocedure('public.connect_request_footage(text,text,text,text)'))), false)
union all select 7, 'ONLY the connector login can run both: not signed-in people, not the public, not the service role, not the computer login',
       coalesce((select bool_and(has_function_privilege('connect_runner', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('node_runner', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_request_download(text,text,text,text)'), to_regprocedure('public.connect_request_footage(text,text,text,text)'))), false)
union all select 8, 'the plan tables are still closed to the connector login (it can only ask through the functions)',
       not has_table_privilege('connect_runner', 'public.download_plans', 'select,insert,update,delete')
       and not (to_regclass('public.footage_plans') is not null and has_table_privilege('connect_runner', 'public.footage_plans', 'select,insert,update,delete'))
  ) t
  union all
  select 2 as k, 'A3 after (step 34)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261120000500_prepared_data.sql (the AI hands Ryagram a table; the person accepts it in the app): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration every row answers false, never an error. Every column is named.
select 1 as geo_n, 'the staging table exists and is closed to every API role (anon, signed-in, service, the connector login)' as check_name,
       coalesce(to_regclass('public.prepared_data') is not null
         and not (has_table_privilege('anon', 'public.prepared_data', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.prepared_data', 'select, insert, update, delete')
                  or has_table_privilege('service_role', 'public.prepared_data', 'select, insert, update, delete') or has_table_privilege('connect_runner', 'public.prepared_data', 'select, insert, update, delete')), false) as ok
union all select 2, 'datasets has the two new columns prepared_from and prep_log',
       (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name in ('prepared_from', 'prep_log'))
union all select 3, 'the connector login (and only it) can hand a table over and list the person''s data',
       coalesce((select bool_and(has_function_privilege('connect_runner', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'))
                   and p.oid is not null) and (select count(*) = 2 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'))), false)
union all select 4, 'the four app functions exist and are runnable by a signed-in session, not by anon or the public',
       coalesce((select count(*) = 4 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 5, 'all six are security definer with an empty search path',
       coalesce((select count(*) = 6 and bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)'), to_regprocedure('public.connect_list_my_data(text)'), to_regprocedure('public.my_prepared_data()'),
                                                  to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 6, 'the hand-over names the new scope submit_data and the signed-in functions name the signed-in person (no function takes an owner from the caller)',
       coalesce((select p.prosrc like '%connect_actor(p_token_hash, ''submit_data'')%' from pg_proc p where p.oid = to_regprocedure('public.connect_submit_prepared_data(text,text,text,jsonb,jsonb,jsonb,text)')), false)
       and coalesce((select count(*) = 4 and bool_and(strpos(p.prosrc, 'require_signed_in()') > 0 and strpos(p.prosrc, 'p_owner') = 0)
                 from pg_proc p where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 7, 'the signed-in functions carry the waiting-list check (the gate)',
       coalesce((select count(*) = 4 and bool_and(p.prosrc like '%require_active%') from pg_proc p
                 where p.oid in (to_regprocedure('public.my_prepared_data()'), to_regprocedure('public.my_prepared_data_csv(uuid)'), to_regprocedure('public.discard_prepared_data(uuid)'), to_regprocedure('public.mark_prepared_accepted(uuid,uuid)'))), false)
union all select 8, 'the consent page now offers submit_data, and the five scopes that were there are still offered',
       coalesce(ryagram_private.connect_offered_scopes() @> array['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data']::text[], false)
  ) t
  union all
  select 3 as k, 'A4 after (step 38)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261120000600_prepared_purge_daily.sql (the daily purge also removes expired AI-prepared tables): one SELECT, read-only, changes nothing. Every ok must be true. Before the migration every row answers false, never an error. Every column is named.
select 1 as geo_n, 'connect_purge exists and still answers its original keys, the editor key and the new prepared key' as check_name,
       coalesce(to_regprocedure('public.connect_purge()') is not null
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''requests'', a%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''edit'', e%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%''prepared'', f%', false) as ok
union all select 2, 'it calls the prepared purge, guarded, so a failure there cannot stop the rest',
       coalesce(pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%to_regprocedure(''ryagram_private.prepared_purge()'')%'
         and pg_get_functiondef(to_regprocedure('public.connect_purge()')) like '%ryagram_private.prepared_purge()%exception when others%', false)
union all select 3, 'nobody but the database owner and the dashboard can run connect_purge (anon, signed-in and the connector login cannot)',
       coalesce(to_regprocedure('public.connect_purge()') is not null
         and not has_function_privilege('anon', to_regprocedure('public.connect_purge()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_purge()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('public.connect_purge()'), 'execute'), false)
union all select 4, 'the prepared purge itself is closed to every API role',
       coalesce(to_regprocedure('ryagram_private.prepared_purge()') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.prepared_purge()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.prepared_purge()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('ryagram_private.prepared_purge()'), 'execute'), false)
  ) t
  union all
  select 4 as k, 'A5 after (step 41)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000100_account_delete_paid.sql (GEO 2026-11-21; CC1 12:36 G1): two service-only functions: account_erase_paid_content (a paying customer's files' rows) and account_redact_contact (their email in support, invite and application rows).
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration every row answers false (the functions do not exist yet), never an error. NOT APPLIED.
select 1 as geo_n, 'account_erase_paid_content exists, is security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_erase_paid_content(uuid)')), false) as ok
union all select 2, 'account_erase_paid_content removes rows only through mark_uploads_removed (only once the file is gone)' as check_name,
       coalesce((select p.prosrc like '%public.mark_uploads_removed%' and p.prosrc like '%uploads_left%' and p.prosrc like '%films_left%' from pg_proc p where p.oid = to_regprocedure('public.account_erase_paid_content(uuid)')), false) as ok
union all select 3, 'account_redact_contact exists, is security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
union all select 4, 'account_redact_contact redacts support, invite and creator-application rows, each application with its own address' as check_name,
       coalesce((select p.prosrc like '%public.support_requests%' and p.prosrc like '%public.invite_redemptions%' and p.prosrc like '%public.creator_applications%' and p.prosrc like '%''redacted+'' || c.id%' from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
  ) t
  union all
  select 5 as k, 'A6 after (step 39)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000200_expired_films_really_gone.sql (an expired paid film is marked deleted only once its file is really gone; GEO's privacy review M2): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first three rows answer false, never an error. Every column is named.
select 1 as geo_n, 'render_orders_tick no longer marks a delivery deleted (it lists due_deliveries instead)' as check_name,
       coalesce((select p.prosrc like '%''due_deliveries''%' and p.prosrc not like '%update public.render_deliveries set deleted_at%'
                 from pg_proc p where p.oid = to_regprocedure('public.render_orders_tick()')), false) as ok
union all select 2, 'mark_deliveries_removed exists and checks storage.objects in the ryagram-artifacts bucket',
       coalesce((select p.prosrc like '%storage.objects o where o.bucket_id = ''ryagram-artifacts''%'
                 from pg_proc p where p.oid = to_regprocedure('public.mark_deliveries_removed(uuid[])')), false)
union all select 3, 'mark_deliveries_removed never marks a film inside its 30 days (expires_at < now())',
       coalesce((select p.prosrc like '%r.expires_at < now()%' from pg_proc p where p.oid = to_regprocedure('public.mark_deliveries_removed(uuid[])')), false)
union all select 4, 'both are security definer with an empty search path',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('public.render_orders_tick()'), to_regprocedure('public.mark_deliveries_removed(uuid[])'))), false)
union all select 5, 'both are runnable by the service role only (not by anon, signed-in sessions or the public)',
       coalesce((select bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                                 and not has_function_privilege('authenticated', p.oid, 'execute')
                                 and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                 from pg_proc p where p.oid in (to_regprocedure('public.render_orders_tick()'), to_regprocedure('public.mark_deliveries_removed(uuid[])'))), false)
union all select 6, 'the customer still cannot reach an expired film (delivery_object refuses past expires_at)',
       coalesce((select p.prosrc like '%d.deleted_at is not null or d.expires_at < now()%' from pg_proc p where p.oid = to_regprocedure('ryagram_private.delivery_object(uuid,uuid)')), false)
  ) t
  union all
  select 6 as k, 'A7 after (step 40)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000300_upload_films_gone.sql (films made FROM a customer's upload go when the upload goes; GEO's privacy review M3): one SELECT, read-only, changes nothing. Every ok must be true.
-- Run it on the same project right after the migration. Before the migration the first four rows answer false, never an error. Every column is named.
select 1 as geo_n, 'the rule (ryagram_private.upload_film_due) only takes films of REMOVED uploads, the owner''s own' as check_name,
       coalesce((select p.prosrc like '%a.owner_id = d.owner_id%' and p.prosrc like '%d.source = ''upload'' and d.deleted_at is not null%'
                 from pg_proc p where p.oid = to_regprocedure('ryagram_private.upload_film_due(public.artifacts)')), false) as ok
union all select 2, 'the rule only takes FINISHED jobs (never one still uploading)',
       coalesce((select p.prosrc like '%j.state in (''complete'', ''failed'', ''cancelled'', ''editorial_action_required'')%'
                 from pg_proc p where p.oid = to_regprocedure('ryagram_private.upload_film_due(public.artifacts)')), false)
union all select 3, 'the rule keeps a final with a live delivery under Don''t keep (it goes when the person deleted the data)',
       coalesce((select p.prosrc like '%d.delete_requested_at is not null or d.trashed_at is not null%r.deleted_at is null%'
                 from pg_proc p where p.oid = to_regprocedure('ryagram_private.upload_film_due(public.artifacts)')), false)
union all select 4, 'mark_upload_films_removed checks storage.objects in the ryagram-artifacts bucket',
       coalesce((select p.prosrc like '%storage.objects o where o.bucket_id = ''ryagram-artifacts''%'
                 from pg_proc p where p.oid = to_regprocedure('public.mark_upload_films_removed(uuid[])')), false)
union all select 5, 'all three are security definer with an empty search path',
       coalesce((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')))
                 from pg_proc p where p.oid in (to_regprocedure('ryagram_private.upload_film_due(public.artifacts)'),
                                                to_regprocedure('public.upload_films_due_for_deletion(integer)'),
                                                to_regprocedure('public.mark_upload_films_removed(uuid[])'))), false)
union all select 6, 'the two public ones are runnable by the service role only; the rule by nobody (not anon, signed-in or the public)',
       coalesce((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                                 and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                                 and (has_function_privilege('service_role', p.oid, 'execute') = (p.oid <> to_regprocedure('ryagram_private.upload_film_due(public.artifacts)'))))
                 from pg_proc p where p.oid in (to_regprocedure('ryagram_private.upload_film_due(public.artifacts)'),
                                                to_regprocedure('public.upload_films_due_for_deletion(integer)'),
                                                to_regprocedure('public.mark_upload_films_removed(uuid[])'))), false)
  ) t
  union all
  select 7 as k, 'A8 after (step 42)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000400_retention_outbox_support.sql (GEO 2026-11-21; CC1 12:36 G1): retention_purge (the mail we sent and unanswered help requests get end dates) and account_redact_contact (on delete, mail to the person is erased and their address leaves other messages).
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration rows 1 and 3 answer false (rows 2 and 4 are already true), never an error. NOT APPLIED.
select 1 as geo_n, 'retention_purge purges unanswered help requests after 12 months and the mail we sent, never urgent mail' as check_name,
       coalesce((select p.prosrc like '%help_requests_unanswered%' and p.prosrc like '%public.ops_outbox where kind = ''invite''%' and p.prosrc like '%kind in (''alert'', ''digest'', ''ack'')%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 2, 'retention_purge is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 3, 'account_redact_contact also erases mail to the person and replaces their whole address, in any case, in other messages' as check_name,
       coalesce((select p.prosrc like '%delete from public.ops_outbox o where o.kind <> ''urgent''%' and p.prosrc like '%regexp_replace(o.body, pat, ''[deleted address]'', ''gi'')%' from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
union all select 4, 'account_redact_contact is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
  ) t
  union all
  select 8 as k, 'A9 after (step 43)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000500_unfinished_uploads_purged.sql (GEO 2026-11-21; CC1 12:36 G1): uploads_due_for_deletion also lists an upload never finished, a day after its slot was made.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 1 as geo_n, 'uploads_due_for_deletion lists an upload never finished a day after its slot was made' as check_name,
       coalesce((select p.prosrc like '%d.uploaded_at is null and d.created_at < now() - interval ''1 day''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 2, 'uploads_due_for_deletion keeps its old rules (Delete, Recently deleted, Don''t keep, rejected)' as check_name,
       coalesce((select p.prosrc like '%d.delete_requested_at is not null%' and p.prosrc like '%d.trashed_at < now() - interval ''7 days''%' and p.prosrc like '%d.retention = ''dont_keep''%' and p.prosrc like '%d.status = ''rejected''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 3, 'uploads_due_for_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
  ) t
  union all
  select 9 as k, 'A10 after (step 44)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000550_delete_revokes_ai.sql (GEO 2026-11-21; CC1 12:36 G1): account_request_deletion also revokes the person's AI connection grants and tokens.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 1 as geo_n, 'account_request_deletion revokes the person''s AI connection grants and tokens' as check_name,
       coalesce((select p.prosrc like '%update public.connect_grants set revoked_at = now() where owner_id = p_owner%' and p.prosrc like '%update public.connect_tokens set revoked_at = now() where owner_id = p_owner%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 2, 'account_request_deletion still records the request once' as check_name,
       coalesce((select p.prosrc like '%insert into public.account_deletion_requests%' and p.prosrc like '%on conflict (owner_id) do nothing%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 3, 'account_request_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
  ) t
  union all
  select 10 as k, 'A11 after (step 45)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000600_prepared_tombstone.sql (GEO 2026-11-21; CC1 12:36 G1): mark_uploads_removed also drops the AI's declarations; account_request_deletion also clears the person's waiting AI-prepared tables.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration rows 1 and 3 answer false (rows 2 and 4 are already true), never an error. NOT APPLIED.
select 1 as geo_n, 'mark_uploads_removed drops the AI''s declarations (prep_log, prepared_from) from a deleted upload' as check_name,
       coalesce((select p.prosrc like '%prep_log = null, prepared_from = null%' from pg_proc p where p.oid = to_regprocedure('public.mark_uploads_removed(uuid[])')), false) as ok
union all select 2, 'mark_uploads_removed is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.mark_uploads_removed(uuid[])')), false) as ok
union all select 3, 'account_request_deletion clears the person''s waiting AI-prepared tables and still revokes their AI connections (000550''s lines)' as check_name,
       coalesce((select p.prosrc like '%update public.prepared_data set csv_text = ''''%' and p.prosrc like '%update public.connect_grants set revoked_at%' and p.prosrc like '%update public.connect_tokens set revoked_at%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 4, 'account_request_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
  ) t
  union all
  select 11 as k, 'A12 after (step 35)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261121000700_connect_ai_open_to_all.sql (Connect-an-AI opens to every signed-up account): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 36 (flag ON) the row "the flag is ..." says on and the rest stay true. BEFORE the migration the first four rows answer false and the last says NOT THERE YET with false, and it never errors (the flag is read through to_jsonb, so a missing column is a false, not a failed statement; 11-23, a subagent's audit found the old form errored before the migration).
select 1 as geo_n, 'the flag exists' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all'), false) as ok
union all select 2, 'the helper and the admin function exist',
       to_regprocedure('ryagram_private.connect_open()') is not null and to_regprocedure('public.admin_connect_set_open(boolean)') is not null
union all select 3, 'nobody but an administrator session can flip it from the app: signed-in can run the function, anon and the public cannot, the connector login cannot, and the helper is closed to every API role',
       coalesce(to_regprocedure('public.admin_connect_set_open(boolean)') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and to_regprocedure('ryagram_private.connect_open()') is not null
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('ryagram_private.connect_open()'), 'execute'), false)
union all select 4, 'the person rule still names an enabled list row, an administrator and a worker',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_access%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_open()%', false)
union all select 5, 'the flag is ' || case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all') then 'NOT THERE YET: the migration has not run'
                                       when coalesce((select (to_jsonb(f) ->> 'open_to_all')::boolean from public.connect_flags f where f.id), false) then 'ON: every signed-up account may connect an AI' else 'OFF: only the invited list (the state right after the migration)' end,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all') and (select count(*) = 1 from public.connect_flags where id)
  ) t
  union all
  select 12 as k, 'A13 after (step 46)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261121000800_join_open.sql (sign-up open at launch): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 47 (flag ON) the last row says on and the rest stay true. Before the migration every row answers false, never an error.
select 1 as geo_n, 'the flag exists, is not null and is on the one settings row' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'join_open' and is_nullable = 'NO'), false)
       and coalesce((select count(*) = 1 from public.ops_settings), false) as ok
union all select 2, 'join_reserve asks the flag as well as the waiting switch, and is still for the service role only',
       coalesce(to_regprocedure('public.join_reserve(text,text)') is not null
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%join_open%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%waiting_on()%'
         and has_function_privilege('service_role', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.join_reserve(text,text)'), 'execute'), false)
union all select 3, 'join_reserve still has the join limits and the turn-taking lock',
       coalesce(pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%pg_advisory_xact_lock%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%join_daily_max%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%''full''%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%>= 10%', false)
union all select 4, 'join_release (gives a try back after a failed email send) exists and is for the service role only',
       coalesce(to_regprocedure('public.join_release(text,text)') is not null
         and has_function_privilege('service_role', to_regprocedure('public.join_release(text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.join_release(text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.join_release(text,text)'), 'execute'), false)
union all select 5, 'the size of sign-up is a setting: ops_settings.join_daily_max exists, is not null, defaults to 200 and cannot be negative',
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'join_daily_max' and is_nullable = 'NO' and column_default = '200'), false)
       and coalesce(exists (select 1 from pg_constraint c where c.conrelid = 'public.ops_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%join_daily_max >= 0%'), false)
union all select 6, 'nobody signed in or anonymous can read or write the settings row (the flag is the dashboards alone)',
       coalesce(not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'select')
         and not has_table_privilege('authenticated', 'public.ops_settings', 'update') and not has_table_privilege('service_role', 'public.ops_settings', 'update'), false)
union all select 7, 'the 18+ record: the table is closed to every API role and the trigger on new accounts is there',
       coalesce(to_regclass('public.account_adult_confirmation') is not null
         and not has_table_privilege('anon', 'public.account_adult_confirmation', 'select') and not has_table_privilege('authenticated', 'public.account_adult_confirmation', 'select')
         and not has_table_privilege('service_role', 'public.account_adult_confirmation', 'insert') and not has_table_privilege('authenticated', 'public.account_adult_confirmation', 'insert')
         and exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'account_adult_new_trg' and not t.tgisinternal), false)
union all select 8, 'sign-up is ' || case when coalesce((select (to_jsonb(o) ->> 'join_open')::boolean from public.ops_settings o limit 1), false) then 'OPEN: a stranger who joins is '
                                       || case when coalesce((select (to_jsonb(o) ->> 'waiting_accounts')::boolean from public.ops_settings o limit 1), false) then 'put on the waiting list (the brake, step 20, is on)' else 'let in at once' end
                                  else 'CLOSED by this flag (the state right after the migration)' end,
       (select count(*) = 1 from public.ops_settings)
  ) t
  union all
  select 13 as k, 'A14 after (step 51)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000100_free_preview_machine_faults.sql (a free preview is not used up by the render machine's own fault): ONE read-only SELECT, changes nothing. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2, 3 and 5 are FALSE and the others true. AFTER it every row must be true. If row 1 is false the credits ledger (phase-2b/credits_ledger.sql) is not applied: apply it first
-- (the file already carries this rule). The statement never errors, whichever state the database is in.
select 1 as geo_n, 'the credits ledger is applied: ryagram_private.free_previews_used exists' as check_name,
       to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null as ok
union all select 2, 'a failed preview that ended in engine_unsupported (the render machine cannot make it) is NOT counted against the free previews',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%engine_unsupported%', false)
union all select 3, 'a failed preview that ended in limit_exceeded (the machine ran out of memory or disk) is not counted against a project''s 6 (it still counts in the 15 a day)',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%limit_exceeded%' and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%p_since is null%', false)
union all select 4, 'an infrastructure failure is still not counted, and only FAILED previews are skipped (a finished or cancelled one counts)',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%state = ''failed''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%error_class = ''infrastructure''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%job_type = ''preview''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%free_preview%', false)
union all select 5, 'a preview cancelled before a machine picked it up (cancelled, never claimed) is not counted either',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%state = ''cancelled'' and claimed_at is null%', false)
union all select 6, 'nobody signed in, anonymous or the connector login can run it (it is the ledger''s own helper)',
       coalesce(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute'), false)
  ) t
  union all
  select 14 as k, 'A15+A16 after (step 60)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261123000200_queue_cap_per_owner.sql (A15) and 20261123000300_blocked_story_views.sql (A16) (GEO 2026-11-23; BUILDER builder-queue-cap-1123).
-- One SELECT, read-only, changes nothing; every column is named. After BOTH migrations every ok must be true. If one is false: STOP, tell CC1.
-- After A15 alone rows 1 to 3 are true and rows 4 and 5 false; before A15 rows 1 to 5 are false; never an error. Row 6 is true at every stage.
-- What it promises a stranger: one person can have at most 2 sheets or previews waiting for the render PC, and at most 2 open orders ('You have 2 films waiting...'),
-- and a sheet or preview of a film the engine is known to fail is refused before it queues ('This film is not available yet...').
select 1 as geo_n, 'the waiting-films limit is a setting (ops_settings.queue_cap_per_owner, built in as 2)' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings'
                and column_name = 'queue_cap_per_owner' and column_default = '2') as ok
union all select 2, 'the limit strangers meet NOW is 2 (if not, someone changed it: tell CC1)' as check_name,
       coalesce((select (to_jsonb(o) ->> 'queue_cap_per_owner') = '2' from public.ops_settings o limit 1), false) as ok
union all select 3, 'a person''s own new sheet or preview, and a new order, are checked against the limit (queue_cap_check, order_cap_check)' as check_name,
       coalesce((select p.prosrc like '%queue_cap_check%' from pg_proc p
                  where p.oid = to_regprocedure('ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)')), false)
         and to_regprocedure('ryagram_private.submit_job_for_base(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)') is not null
         and coalesce((select bool_or(p.prosrc like '%order_cap_check%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'ryagram_private' and p.proname = 'order_submit'), false) as ok
union all select 4, 'the blocked-film list is there and closed to every API role (its 58 pairs are proven by BUILDER''s test)' as check_name,
       coalesce(to_regclass('ryagram_private.blocked_story_views') is not null
         and not has_table_privilege('anon', to_regclass('ryagram_private.blocked_story_views'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.blocked_story_views'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.blocked_story_views'), 'select'), false) as ok
union all select 5, 'new sheets, previews and orders are checked against the blocked list' as check_name,
       coalesce((select p.prosrc like '%blocked_view_check%' from pg_proc p
                  where p.oid = to_regprocedure('ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)')), false)
         and coalesce((select bool_or(p.prosrc like '%blocked_view_check%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'ryagram_private' and p.proname = 'order_submit'), false) as ok
union all select 6, 'no signed-in person, visitor or service key can call the private checks directly' as check_name,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'ryagram_private'
                      and p.proname in ('queue_cap_check', 'order_cap_check', 'blocked_view_check', 'blocked_view_in', 'submit_job_for', 'submit_job_for_base', 'order_submit', 'order_submit_base')
                      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                           or has_function_privilege('service_role', p.oid, 'execute'))) as ok
  ) t
  union all
  select 15 as k, 'A17 after (step 59)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261123000400_retention_join_attempts.sql (A17; GEO 2026-11-23, GAMES 11:04): the daily retention purge also removes old sign-up and invite-code tries.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration (or after its rollback) rows 1 and 2 answer false and row 3 is still true, never an error. If a row is false after A17: STOP, tell CC1.
-- What it promises: join_attempts (the scrambled address and email of a sign-up try) go after 2 days, as the Privacy page says, and invite_attempts
-- (failed invite-code guesses) after 1 day. The purge runs once a New York day, so a row can live up to about a day longer than that.
select 1 as geo_n, 'retention_purge removes sign-up tries (join_attempts) older than 2 days' as check_name,
       coalesce((select p.prosrc like '%delete from public.join_attempts where at < now() - interval ''2 days''%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 2, 'retention_purge removes failed invite-code guesses (invite_attempts) older than 1 day' as check_name,
       coalesce((select p.prosrc like '%delete from public.invite_attempts where at < now() - interval ''1 day''%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 3, 'retention_purge is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path='))
                   and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')
                  from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
  ) t
  union all
  select 16 as k, 'A18 after (step 61)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000500_connect_whoami_desktop_app.sql (the connector tells an AI whether the account may have the desktop app): ONE read-only SELECT, changes nothing, never errors. Every column is named.
-- BEFORE the migration row 1 is FALSE and row 2 is true; AFTER it both are true.
select 1 as geo_n, 'connect_whoami answers desktop_app, by the same rule as the app download (not a worker; an invited tester or an administrator)' as check_name,
       coalesce(pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%''desktop_app'', desk%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%s.local_compute%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.workers%', false) as ok
union all select 2, 'connect_whoami is still for the connector login only (the connector may run it; a signed-in person, anonymous and the public may not)',
       coalesce(to_regprocedure('public.connect_whoami(text)') is not null
         and has_function_privilege('connect_runner', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_whoami(text)'), 'execute'), false)
  ) t
  union all
  select 17 as k, 'A19 after (step 63)'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000600_welcome_credits.sql (8 welcome credits at email verification, once per address ever): ONE read-only SELECT, changes nothing, never errors, prints no address. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2 to 6 are FALSE, rows 7 and 8 are true. AFTER it all eight are true. Row 8 only says the number of credits a verification gives now (the setting), and is always true.
select 1 as geo_n, 'the credits ledger is live: public.grant_credits exists (the migration gives credits only through it)' as check_name,
       to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is not null as ok
union all select 2, 'the setting ops_settings.welcome_credits exists, is not null, defaults to 8 and is between 0 and 100',
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'welcome_credits' and is_nullable = 'NO' and column_default = '8'), false)
       and coalesce(exists (select 1 from pg_constraint c where c.conrelid = 'public.ops_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%welcome_credits >= 0%' and pg_get_constraintdef(c.oid) like '%welcome_credits <= 100%'), false)
union all select 3, 'the once-per-address table exists, keeps only a scrambled address (no user id, no foreign key) and is closed to every API role',
       coalesce(to_regclass('ryagram_private.welcome_credit_grants') is not null
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants' and column_name in ('email_hash', 'granted_at'))
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants')
         and not exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.welcome_credit_grants') and c.contype = 'f')
         and not has_table_privilege('anon', to_regclass('ryagram_private.welcome_credit_grants'), 'select') and not has_table_privilege('authenticated', to_regclass('ryagram_private.welcome_credit_grants'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.welcome_credit_grants'), 'select'), false)
union all select 4, 'the trigger on new and newly verified accounts exists (insert, or update of email_confirmed_at)',
       coalesce(exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'welcome_credits_trg' and not t.tgisinternal
                         and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE OF email_confirmed_at%'), false)
union all select 5, 'the function gives credits only through grant_credits, once per scrambled address, skips invite-code accounts, administrators and workers, and turns any error into a warning',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.grant_credits(%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%on conflict (email_hash) do nothing%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.invite_redemptions%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%exception when others%', false)
union all select 6, 'nobody signed in, anonymous or the connector login can run the function',
       coalesce(to_regprocedure('ryagram_private.welcome_credits_on_verified()') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute'), false)
union all select 7, 'the settings row is there and nobody signed in or anonymous can read or write it',
       (select count(*) = 1 from public.ops_settings)
       and not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'update')
union all select 8, 'a verification gives ' || coalesce((select (to_jsonb(o) ->> 'welcome_credits') from public.ops_settings o limit 1), 'nothing: the migration is not applied') || ' credits now (the setting; 0 = off)', true
  ) t
),
want(k, n, ok) as (values (0, 1, true), (0, 2, true), (0, 3, true), (0, 4, true), (0, 5, true), (0, 6, true), (1, 1, true), (1, 2, true), (1, 3, true), (1, 4, true), (1, 5, true), (1, 6, true), (1, 7, true), (1, 8, true), (2, 1, true), (2, 2, true), (2, 3, true), (2, 4, true), (2, 5, true), (2, 6, true), (2, 7, true), (2, 8, true), (3, 1, true), (3, 2, true), (3, 3, true), (3, 4, true), (4, 1, true), (4, 2, true), (4, 3, true), (4, 4, true), (5, 1, true), (5, 2, true), (5, 3, true), (5, 4, true), (5, 5, true), (5, 6, true), (6, 1, true), (6, 2, true), (6, 3, true), (6, 4, true), (6, 5, true), (6, 6, true), (7, 1, true), (7, 2, true), (7, 3, true), (7, 4, true), (8, 1, true), (8, 2, true), (8, 3, true), (9, 1, true), (9, 2, true), (9, 3, true), (10, 1, true), (10, 2, true), (10, 3, true), (10, 4, true), (11, 1, true), (11, 2, true), (11, 3, true), (11, 4, true), (11, 5, true), (12, 1, true), (12, 2, true), (12, 3, true), (12, 4, true), (12, 5, true), (12, 6, true), (12, 7, true), (12, 8, true), (13, 1, true), (13, 2, true), (13, 3, true), (13, 4, true), (13, 5, true), (13, 6, true), (14, 1, true), (14, 2, true), (14, 3, true), (14, 4, true), (14, 5, true), (14, 6, true), (15, 1, true), (15, 2, true), (15, 3, true), (16, 1, true), (16, 2, true), (17, 1, true), (17, 2, true), (17, 3, true), (17, 4, true), (17, 5, true), (17, 6, true), (17, 7, true), (17, 8, true)),
want_rows(k, rows_wanted) as (values
(0, 6),
(1, 8),
(2, 8),
(3, 4),
(4, 4),
(5, 6),
(6, 6),
(7, 4),
(8, 3),
(9, 3),
(10, 4),
(11, 5),
(12, 8),
(13, 6),
(14, 6),
(15, 3),
(16, 2),
(17, 8)),
labels(k, step) as (select distinct k, step from got),
bad as (
  select g.k, g.step, g.n, g.check_name, g.ok, w.ok as wanted from got g left join want w on w.k = g.k and w.n = g.n
  where w.ok is null or g.ok is distinct from w.ok
  union all
  select r.k, coalesce(l.step, 'check ' || r.k), null::bigint, 'this check gave ' || coalesce(c.got, 0) || ' rows, ' || r.rows_wanted || ' wanted', null::boolean, null::boolean
  from want_rows r left join labels l on l.k = r.k left join (select k, count(*)::int as got from got group by k) c on c.k = r.k
  where coalesce(c.got, 0) <> r.rows_wanted
)
select result, step, row_no, check_name, ok, wanted from (
  select 0 as o, 0 as k, 0 as n,
         case when (select count(*) from bad) = 0 then 'PASS: A1 to A19 are all applied and every AFTER row is true (' || (select count(*) from got) || ' rows)'
              else 'STOP: ' || (select count(*) from bad) || ' row(s) not as expected; the first is ' || (select step || coalesce(' row ' || n, '') from bad order by k, n nulls first limit 1) || '. Send GEO this grid; do not undo anything yourself.' end as result,
         null::text as step, null::bigint as row_no, null::text as check_name, null::boolean as ok, null::boolean as wanted
  union all
  select 1, k, coalesce(n, 0), 'not as expected', step, n, check_name, ok, wanted from bad
) v order by o, k, n;

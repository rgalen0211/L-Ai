-- BEFORE the AI-prepared-data step (CONNECT, 2026-11-20, Q634): ONE read-only SELECT, changes nothing. Every ok must be true EXCEPT the rows marked NOT YET, which are the new things and must be FALSE today.
-- WHY: the AI hands over a table, you press Accept, and your browser then runs the EXISTING "Your own data" upload path (slot, file, worker read, confirm the columns with the tick, attach). So the upload system, the trust tick,
-- the uploads bucket and the connector's scopes must already be on LIVE. If any row 1 to 14 is false, STOP and send me the row: the new migration would still apply, but the Accept step could not finish.
select 'row 1: datasets has the upload columns (filename_label, mapping, ingest_report, geography)' as check_name,
       (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name in ('filename_label', 'mapping', 'ingest_report', 'geography')) as ok
union all select 'row 2: the ingest queue table exists (the worker reads uploads from it)', to_regclass('public.dataset_ingests') is not null
union all select 'row 3: create_upload(text, text, bigint, retention) exists and is runnable by a signed-in session',
       coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.create_upload(text,text,bigint,public.dataset_retention)')), false)
union all select 'row 4: finish_upload(uuid) exists', to_regprocedure('public.finish_upload(uuid)') is not null
union all select 'row 5: confirm_dataset_mapping WITH the tick (uuid, jsonb, boolean) exists (the trust acknowledgement, RULINGS 2026-10-26)', to_regprocedure('public.confirm_dataset_mapping(uuid,jsonb,boolean)') is not null
union all select 'row 6: attach_upload_to_version(uuid, uuid) exists', to_regprocedure('public.attach_upload_to_version(uuid,uuid)') is not null
union all select 'row 7: the private uploads bucket exists and is not public',
       coalesce((select b.public = false from storage.buckets b where b.id = 'ryagram-uploads'), false)
union all select 'row 8: the datasets trust columns exist (the label is set by the server: trust_label, trust_ack_at)',
       (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name in ('trust_label', 'trust_ack_at'))
union all select 'row 9: ryagram_private.edit_text_ok(text, int) exists (the plain-words rule the hand-over reuses)', to_regprocedure('ryagram_private.edit_text_ok(text,integer)') is not null
union all select 'row 10: ryagram_private.connect_actor(text, text) exists (the connector login proves who it is with a token)', to_regprocedure('ryagram_private.connect_actor(text,text)') is not null
union all select 'row 11: ryagram_private.require_signed_in() exists', to_regprocedure('ryagram_private.require_signed_in()') is not null
union all select 'row 12: ryagram_private.gate_apply() exists (the waiting-list gate)', to_regprocedure('ryagram_private.gate_apply()') is not null
union all select 'row 13: the consent page offers the five scopes that exist (read, write, render_free, edit, fetch_data)',
       coalesce(ryagram_private.connect_offered_scopes() @> array['read', 'write', 'render_free', 'edit', 'fetch_data']::text[], false)
union all select 'row 14: the connector login exists (connect_runner)', exists (select 1 from pg_roles where rolname = 'connect_runner')
union all select 'row 15 (NOT YET, must be FALSE): the staging table is not there yet', to_regclass('public.prepared_data') is not null
union all select 'row 16 (NOT YET, must be FALSE): the new scope submit_data is not offered yet', coalesce(ryagram_private.connect_offered_scopes() @> array['submit_data']::text[], false);

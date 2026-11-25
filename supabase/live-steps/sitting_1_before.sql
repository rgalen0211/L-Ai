-- SITTING PASTE 1 of 3: every BEFORE check, before any migration (GEO sitting_build.py, Wed 11-25; generated: edit sitting_build.py, never this file). Read-only: one SELECT, changes nothing.
-- Copy ALL of this file into the Supabase SQL Editor and Run. Read ONLY the first row: PASS or STOP. On STOP, send GEO the rows below it.
with got as (
  select 0 as k, 'A0 Q634 before-check'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
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
union all select 'row 16 (NOT YET, must be FALSE): the new scope submit_data is not offered yet', coalesce(ryagram_private.connect_offered_scopes() @> array['submit_data']::text[], false)
  ) t
  union all
  select 1 as k, 'A5 before (step 41)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000100_account_delete_paid.sql (GEO 2026-11-21; CC1 12:36 G1): two service-only functions: account_erase_paid_content (a paying customer's files' rows) and account_redact_contact (their email in support, invite and application rows).
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration every row answers false (the functions do not exist yet), never an error. NOT APPLIED.
select 'account_erase_paid_content exists, is security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_erase_paid_content(uuid)')), false) as ok
union all select 'account_erase_paid_content removes rows only through mark_uploads_removed (only once the file is gone)' as check_name,
       coalesce((select p.prosrc like '%public.mark_uploads_removed%' and p.prosrc like '%uploads_left%' and p.prosrc like '%films_left%' from pg_proc p where p.oid = to_regprocedure('public.account_erase_paid_content(uuid)')), false) as ok
union all select 'account_redact_contact exists, is security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
union all select 'account_redact_contact redacts support, invite and creator-application rows, each application with its own address' as check_name,
       coalesce((select p.prosrc like '%public.support_requests%' and p.prosrc like '%public.invite_redemptions%' and p.prosrc like '%public.creator_applications%' and p.prosrc like '%''redacted+'' || c.id%' from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
  ) t
  union all
  select 2 as k, 'A8 before (step 42)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000400_retention_outbox_support.sql (GEO 2026-11-21; CC1 12:36 G1): retention_purge (the mail we sent and unanswered help requests get end dates) and account_redact_contact (on delete, mail to the person is erased and their address leaves other messages).
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration rows 1 and 3 answer false (rows 2 and 4 are already true), never an error. NOT APPLIED.
select 'retention_purge purges unanswered help requests after 12 months and the mail we sent, never urgent mail' as check_name,
       coalesce((select p.prosrc like '%help_requests_unanswered%' and p.prosrc like '%public.ops_outbox where kind = ''invite''%' and p.prosrc like '%kind in (''alert'', ''digest'', ''ack'')%' from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 'retention_purge is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.retention_purge()')), false) as ok
union all select 'account_redact_contact also erases mail to the person and replaces their whole address, in any case, in other messages' as check_name,
       coalesce((select p.prosrc like '%delete from public.ops_outbox o where o.kind <> ''urgent''%' and p.prosrc like '%regexp_replace(o.body, pat, ''[deleted address]'', ''gi'')%' from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
union all select 'account_redact_contact is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)')), false) as ok
  ) t
  union all
  select 3 as k, 'A9 before (step 43)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000500_unfinished_uploads_purged.sql (GEO 2026-11-21; CC1 12:36 G1): uploads_due_for_deletion also lists an upload never finished, a day after its slot was made.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 'uploads_due_for_deletion lists an upload never finished a day after its slot was made' as check_name,
       coalesce((select p.prosrc like '%d.uploaded_at is null and d.created_at < now() - interval ''1 day''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 'uploads_due_for_deletion keeps its old rules (Delete, Recently deleted, Don''t keep, rejected)' as check_name,
       coalesce((select p.prosrc like '%d.delete_requested_at is not null%' and p.prosrc like '%d.trashed_at < now() - interval ''7 days''%' and p.prosrc like '%d.retention = ''dont_keep''%' and p.prosrc like '%d.status = ''rejected''%' from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
union all select 'uploads_due_for_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.uploads_due_for_deletion(integer)')), false) as ok
  ) t
  union all
  select 4 as k, 'A10 before (step 44)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- AFTER 20261121000550_delete_revokes_ai.sql (GEO 2026-11-21; CC1 12:36 G1): account_request_deletion also revokes the person's AI connection grants and tokens.
-- One SELECT, read-only, changes nothing; every column is named. Right after the migration every ok must be true.
-- Before the migration row 1 answers false (rows 2 and 3 are already true), never an error. NOT APPLIED.
select 'account_request_deletion revokes the person''s AI connection grants and tokens' as check_name,
       coalesce((select p.prosrc like '%update public.connect_grants set revoked_at = now() where owner_id = p_owner%' and p.prosrc like '%update public.connect_tokens set revoked_at = now() where owner_id = p_owner%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 'account_request_deletion still records the request once' as check_name,
       coalesce((select p.prosrc like '%insert into public.account_deletion_requests%' and p.prosrc like '%on conflict (owner_id) do nothing%' from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
union all select 'account_request_deletion is still security definer with an empty search path, and only the service role may run it' as check_name,
       coalesce((select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')) and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)')), false) as ok
  ) t
  union all
  select 5 as k, 'A12 before (step 35)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261121000700_connect_ai_open_to_all.sql (Connect-an-AI opens to every signed-up account): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 36 (flag ON) the row "the flag is ..." says on and the rest stay true. BEFORE the migration the first four rows answer false and the last says NOT THERE YET with false, and it never errors (the flag is read through to_jsonb, so a missing column is a false, not a failed statement; 11-23, a subagent's audit found the old form errored before the migration).
select 'the flag exists' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all'), false) as ok
union all select 'the helper and the admin function exist',
       to_regprocedure('ryagram_private.connect_open()') is not null and to_regprocedure('public.admin_connect_set_open(boolean)') is not null
union all select 'nobody but an administrator session can flip it from the app: signed-in can run the function, anon and the public cannot, the connector login cannot, and the helper is closed to every API role',
       coalesce(to_regprocedure('public.admin_connect_set_open(boolean)') is not null
         and has_function_privilege('authenticated', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('public.admin_connect_set_open(boolean)'), 'execute')
         and to_regprocedure('ryagram_private.connect_open()') is not null
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.connect_open()'), 'execute')
         and not has_function_privilege('connect_runner', to_regprocedure('ryagram_private.connect_open()'), 'execute'), false)
union all select 'the person rule still names an enabled list row, an administrator and a worker',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_access%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.connect_person_ok(uuid)')) like '%connect_open()%', false)
union all select 'the flag is ' || case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all') then 'NOT THERE YET: the migration has not run'
                                       when coalesce((select (to_jsonb(f) ->> 'open_to_all')::boolean from public.connect_flags f where f.id), false) then 'ON: every signed-up account may connect an AI' else 'OFF: only the invited list (the state right after the migration)' end,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connect_flags' and column_name = 'open_to_all') and (select count(*) = 1 from public.connect_flags where id)
  ) t
  union all
  select 6 as k, 'A13 before (step 46)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261121000800_join_open.sql (sign-up open at launch): ONE read-only SELECT, changes nothing. Every column is named.
-- Right after the migration (flag still OFF): every ok must be true. After step 47 (flag ON) the last row says on and the rest stay true. Before the migration every row answers false, never an error.
select 'the flag exists, is not null and is on the one settings row' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'join_open' and is_nullable = 'NO'), false)
       and coalesce((select count(*) = 1 from public.ops_settings), false) as ok
union all select 'join_reserve asks the flag as well as the waiting switch, and is still for the service role only',
       coalesce(to_regprocedure('public.join_reserve(text,text)') is not null
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%join_open%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%waiting_on()%'
         and has_function_privilege('service_role', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.join_reserve(text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.join_reserve(text,text)'), 'execute'), false)
union all select 'join_reserve still has the join limits and the turn-taking lock',
       coalesce(pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%pg_advisory_xact_lock%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%join_daily_max%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%''full''%'
         and pg_get_functiondef(to_regprocedure('public.join_reserve(text,text)')) like '%>= 10%', false)
union all select 'join_release (gives a try back after a failed email send) exists and is for the service role only',
       coalesce(to_regprocedure('public.join_release(text,text)') is not null
         and has_function_privilege('service_role', to_regprocedure('public.join_release(text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.join_release(text,text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.join_release(text,text)'), 'execute'), false)
union all select 'the size of sign-up is a setting: ops_settings.join_daily_max exists, is not null, defaults to 200 and cannot be negative',
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'join_daily_max' and is_nullable = 'NO' and column_default = '200'), false)
       and coalesce(exists (select 1 from pg_constraint c where c.conrelid = 'public.ops_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%join_daily_max >= 0%'), false)
union all select 'nobody signed in or anonymous can read or write the settings row (the flag is the dashboards alone)',
       coalesce(not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'select')
         and not has_table_privilege('authenticated', 'public.ops_settings', 'update') and not has_table_privilege('service_role', 'public.ops_settings', 'update'), false)
union all select 'the 18+ record: the table is closed to every API role and the trigger on new accounts is there',
       coalesce(to_regclass('public.account_adult_confirmation') is not null
         and not has_table_privilege('anon', 'public.account_adult_confirmation', 'select') and not has_table_privilege('authenticated', 'public.account_adult_confirmation', 'select')
         and not has_table_privilege('service_role', 'public.account_adult_confirmation', 'insert') and not has_table_privilege('authenticated', 'public.account_adult_confirmation', 'insert')
         and exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'account_adult_new_trg' and not t.tgisinternal), false)
union all select 'sign-up is ' || case when coalesce((select (to_jsonb(o) ->> 'join_open')::boolean from public.ops_settings o limit 1), false) then 'OPEN: a stranger who joins is '
                                       || case when coalesce((select (to_jsonb(o) ->> 'waiting_accounts')::boolean from public.ops_settings o limit 1), false) then 'put on the waiting list (the brake, step 20, is on)' else 'let in at once' end
                                  else 'CLOSED by this flag (the state right after the migration)' end,
       (select count(*) = 1 from public.ops_settings)
  ) t
  union all
  select 7 as k, 'A14 before (step 51)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000100_free_preview_machine_faults.sql (a free preview is not used up by the render machine's own fault): ONE read-only SELECT, changes nothing. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2, 3 and 5 are FALSE and the others true. AFTER it every row must be true. If row 1 is false the credits ledger (phase-2b/credits_ledger.sql) is not applied: apply it first
-- (the file already carries this rule). The statement never errors, whichever state the database is in.
select 'the credits ledger is applied: ryagram_private.free_previews_used exists' as check_name,
       to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null as ok
union all select 'a failed preview that ended in engine_unsupported (the render machine cannot make it) is NOT counted against the free previews',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%engine_unsupported%', false)
union all select 'a failed preview that ended in limit_exceeded (the machine ran out of memory or disk) is not counted against a project''s 6 (it still counts in the 15 a day)',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%limit_exceeded%' and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%p_since is null%', false)
union all select 'an infrastructure failure is still not counted, and only FAILED previews are skipped (a finished or cancelled one counts)',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%state = ''failed''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%error_class = ''infrastructure''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%job_type = ''preview''%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%free_preview%', false)
union all select 'a preview cancelled before a machine picked it up (cancelled, never claimed) is not counted either',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')) like '%state = ''cancelled'' and claimed_at is null%', false)
union all select 'nobody signed in, anonymous or the connector login can run it (it is the ledger''s own helper)',
       coalesce(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute'), false)
  ) t
  union all
  select 8 as k, 'A18 before (step 61)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000500_connect_whoami_desktop_app.sql (the connector tells an AI whether the account may have the desktop app): ONE read-only SELECT, changes nothing, never errors. Every column is named.
-- BEFORE the migration row 1 is FALSE and row 2 is true; AFTER it both are true.
select 'connect_whoami answers desktop_app, by the same rule as the app download (not a worker; an invited tester or an administrator)' as check_name,
       coalesce(pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%''desktop_app'', desk%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%s.local_compute%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('public.connect_whoami(text)')) like '%public.workers%', false) as ok
union all select 'connect_whoami is still for the connector login only (the connector may run it; a signed-in person, anonymous and the public may not)',
       coalesce(to_regprocedure('public.connect_whoami(text)') is not null
         and has_function_privilege('connect_runner', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('anon', to_regprocedure('public.connect_whoami(text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.connect_whoami(text)'), 'execute'), false)
  ) t
  union all
  select 9 as k, 'A19 before (step 63)'::text as step, row_number() over () as n, t.check_name::text as check_name, t.ok as ok
  from (
-- BEFORE and AFTER 20261123000600_welcome_credits.sql (8 welcome credits at email verification, once per address ever): ONE read-only SELECT, changes nothing, never errors, prints no address. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2 to 6 are FALSE, rows 7 and 8 are true. AFTER it all eight are true. Row 8 only says the number of credits a verification gives now (the setting), and is always true.
select 'the credits ledger is live: public.grant_credits exists (the migration gives credits only through it)' as check_name,
       to_regprocedure('public.grant_credits(uuid,public.credit_entry,integer,text,text,text,text,text)') is not null as ok
union all select 'the setting ops_settings.welcome_credits exists, is not null, defaults to 8 and is between 0 and 100',
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'welcome_credits' and is_nullable = 'NO' and column_default = '8'), false)
       and coalesce(exists (select 1 from pg_constraint c where c.conrelid = 'public.ops_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%welcome_credits >= 0%' and pg_get_constraintdef(c.oid) like '%welcome_credits <= 100%'), false)
union all select 'the once-per-address table exists, keeps only a scrambled address (no user id, no foreign key) and is closed to every API role',
       coalesce(to_regclass('ryagram_private.welcome_credit_grants') is not null
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants' and column_name in ('email_hash', 'granted_at'))
         and (select count(*) = 2 from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants')
         and not exists (select 1 from pg_constraint c where c.conrelid = to_regclass('ryagram_private.welcome_credit_grants') and c.contype = 'f')
         and not has_table_privilege('anon', to_regclass('ryagram_private.welcome_credit_grants'), 'select') and not has_table_privilege('authenticated', to_regclass('ryagram_private.welcome_credit_grants'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.welcome_credit_grants'), 'select'), false)
union all select 'the trigger on new and newly verified accounts exists (insert, or update of email_confirmed_at)',
       coalesce(exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'welcome_credits_trg' and not t.tgisinternal
                         and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE OF email_confirmed_at%'), false)
union all select 'the function gives credits only through grant_credits, once per scrambled address, skips invite-code accounts, administrators and workers, and turns any error into a warning',
       coalesce(pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.grant_credits(%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%on conflict (email_hash) do nothing%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.invite_redemptions%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.app_admins%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%public.workers%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.welcome_credits_on_verified()')) like '%exception when others%', false)
union all select 'nobody signed in, anonymous or the connector login can run the function',
       coalesce(to_regprocedure('ryagram_private.welcome_credits_on_verified()') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.welcome_credits_on_verified()'), 'execute'), false)
union all select 'the settings row is there and nobody signed in or anonymous can read or write it',
       (select count(*) = 1 from public.ops_settings)
       and not has_table_privilege('anon', 'public.ops_settings', 'select') and not has_table_privilege('authenticated', 'public.ops_settings', 'update')
union all select 'a verification gives ' || coalesce((select (to_jsonb(o) ->> 'welcome_credits') from public.ops_settings o limit 1), 'nothing: the migration is not applied') || ' credits now (the setting; 0 = off)', true
  ) t
),
want(k, n, ok) as (values (0, 1, true), (0, 2, true), (0, 3, true), (0, 4, true), (0, 5, true), (0, 6, true), (0, 7, true), (0, 8, true), (0, 9, true), (0, 10, true), (0, 11, true), (0, 12, true), (0, 13, true), (0, 14, true), (0, 15, false), (0, 16, false), (1, 1, false), (1, 2, false), (1, 3, false), (1, 4, false), (2, 1, false), (2, 2, true), (2, 3, false), (2, 4, true), (3, 1, false), (3, 2, true), (3, 3, true), (4, 1, false), (4, 2, true), (4, 3, true), (5, 1, false), (5, 2, false), (5, 3, false), (5, 4, false), (5, 5, false), (6, 1, false), (6, 2, false), (6, 3, true), (6, 4, false), (6, 5, false), (6, 6, true), (6, 7, false), (6, 8, true), (7, 1, true), (7, 2, false), (7, 3, false), (7, 4, true), (7, 5, false), (7, 6, true), (8, 1, false), (8, 2, true), (9, 1, true), (9, 2, false), (9, 3, false), (9, 4, false), (9, 5, false), (9, 6, false), (9, 7, true), (9, 8, true)),
want_rows(k, rows_wanted) as (values
(0, 16),
(1, 4),
(2, 4),
(3, 3),
(4, 3),
(5, 5),
(6, 8),
(7, 6),
(8, 2),
(9, 8)),
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
         case when (select count(*) from bad) = 0 then 'PASS: every BEFORE check is as the paper says; go on to paste 2 (' || (select count(*) from got) || ' rows)'
              else 'STOP: ' || (select count(*) from bad) || ' row(s) not as expected; the first is ' || (select step || coalesce(' row ' || n, '') from bad order by k, n nulls first limit 1) || '. Do NOT run paste 2; send GEO this grid.' end as result,
         null::text as step, null::bigint as row_no, null::text as check_name, null::boolean as ok, null::boolean as wanted
  union all
  select 1, k, coalesce(n, 0), 'not as expected', step, n, check_name, ok, wanted from bad
) v order by o, k, n;

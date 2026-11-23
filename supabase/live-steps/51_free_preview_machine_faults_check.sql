-- BEFORE and AFTER 20261123000100_free_preview_machine_faults.sql (a free preview is not used up by the render machine's own fault): ONE read-only SELECT, changes nothing. Every column is named.
-- BEFORE the migration: row 1 is true (the credits ledger is live), rows 2 and 3 are FALSE and the others true. AFTER it every row must be true. If row 1 is false the credits ledger (phase-2b/credits_ledger.sql) is not applied: apply it first
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
union all select 'nobody signed in, anonymous or the connector login can run it (it is the ledger''s own helper)',
       coalesce(to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is not null
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)'), 'execute'), false);

-- QUEUE ORDER BY WHEN A JOB JOINED THE LINE, THE LIVE STEP (BUILDER branch builder-line-order-steps-1127 = builder-queue-order-1125 b35f0730 merged onto live f6312e3c). Ryan's yes, through CC1's train.
-- WHY: a full film is made when it is ASKED for and joins the line only when Ryan approves it. Today the line is ordered by when a job was MADE, so a film approved now
--   jumps in front of every sheet and preview queued since it was asked for, and a stranger who read 'Number 3 in line' then reads 'Number 4'. After this, the order (the render PC's
--   claim, a tester's own PC, the number a stranger reads, the queue timeout and the Ops page's oldest wait) is by when a job JOINED the line. A retried job keeps its place.
-- THE SERVER HALF SHIPS FIRST. WEB's page words for it (web-queue-order-on-twin-1126, bb3a4c33) go out AFTER this step says PASS, never before.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- ORDER: (1) THIS file: before the change it says STOP (rows 2 to 5 false), as expected.
--   (2) ONCE: paste ALL of supabase/migrations/20261125000100_queue_order_joined_line.sql into the SQL Editor and Run. If it says 'is not the one this change expects', STOP:
--       nothing was changed (it is one transaction), send the sentence to CC1 and BUILDER. Running it twice is safe (a second run says 'already in the joined_line_at order').
--   (3) THIS file again: the FIRST row must say PASS. STOP after the change: paste the undo below at once and tell CC1.
-- UNDO (only if CC1 asks, or step 3 says STOP): paste supabase/rollbacks/20261125000100_queue_order_joined_line_rollback.sql (it puts the five clauses back on created_at and drops
--   the column, the trigger and the index). Then THIS file says STOP again, as before the change. Nobody's jobs or credits change either way.
with c as (
select 2 as n, 'jobs.joined_line_at exists, is never empty and is now() for a new job' as check_name,
       coalesce((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'joined_line_at'
                   and is_nullable = 'NO' and column_default = 'now()'), false) as ok
union all select 3, 'the trigger moves a full film to the end of the line when Ryan approves it, and nothing else touches it (before update of state)',
       coalesce(exists (select 1 from pg_trigger t where t.tgrelid = 'public.jobs'::regclass and t.tgname = 'jobs_joined_line' and not t.tgisinternal
                         and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF state ON public.jobs%')
         and pg_get_functiondef(to_regprocedure('ryagram_private.jobs_joined_line()')) like '%old.state = ''awaiting_approval'' and new.state = ''queued''%'
         and not has_function_privilege('anon', to_regprocedure('ryagram_private.jobs_joined_line()'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('ryagram_private.jobs_joined_line()'), 'execute'), false)
union all select 4, 'the render PC''s claim (with its 2-minute bundle guard), a tester''s PC claim and the number a stranger reads all order by joined_line_at',
       coalesce(replace(pg_get_functiondef(to_regprocedure('public.claim_next_job()')), chr(13), '') like '%then 0 else 1 end, joined_line_at, id%'
         and replace(pg_get_functiondef(to_regprocedure('public.claim_next_job()')), chr(13), '') like '%and o.joined_line_at < now() - interval %'
         and replace(pg_get_functiondef(to_regprocedure('public.claim_next_job()')), chr(13), '') not like '%then 0 else 1 end, created_at, id%'
         and replace(pg_get_functiondef(to_regprocedure('public.node_claim(text)')), chr(13), '') like '%order by joined_line_at, id for update skip locked limit 1%'
         and replace(pg_get_functiondef(to_regprocedure('public.queue_position(uuid)')), chr(13), '') like '%(q.joined_line_at, q.id) < (j.joined_line_at, j.id)%', false)
union all select 5, 'the queue timeout and the Ops page''s oldest wait measure the wait IN LINE',
       coalesce(replace(pg_get_functiondef(to_regprocedure('ryagram_private.expire_stale_queue()')), chr(13), '') like '%and j.joined_line_at < now() - make_interval(mins => s.queue_timeout_min)%'
         and replace(pg_get_functiondef(to_regprocedure('ryagram_private.admin_ops_base()')), chr(13), '') like '%min(joined_line_at)) / 60) from public.jobs where state = ''queued''%', false)
union all select 6, 'the film-bundle rule and the waiting-account gate are still in the claim and the place number',
       coalesce(pg_get_functiondef(to_regprocedure('public.claim_next_job()')) like '%film_bundle%'
         and pg_get_functiondef(to_regprocedure('public.queue_position(uuid)')) like '%perform ryagram_private.require_active()%', false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: the line is ordered by when a job joined it' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;

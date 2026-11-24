-- QUEUE BRAKE (Ryan's lever, Wednesday, ONLY when the line is too long; CC1 10:42 ruling, ENGINE 10:38, BUILDER a8eae0f5, GAMES 10:02 FOLD).
-- WHEN: PART 1 below shows 25 or more jobs waiting (row 2), OR the longest wait in line over 90 minutes (row 3), WHILE row 4 (the render PC's last check-in) is under 5 minutes.
-- Read row 3 here, not step 58's 'oldest made': a full film you approve keeps the time it was ASKED for, so right after an approval step 58 can show
-- a long age while the line is short; row 3 here counts from when each job JOINED the line (GAMES 10:51).
-- The numbers are JOBS, not people: most strangers have 2 waiting, so 25 is about 12 people's first steps, about 2 hours of the render PC.
-- If the check-in is stale, the PC is down: that is a machine problem, NOT this brake (tell CC1 and WORKER).
-- WHAT IT DOES: while the brake is set, a stranger's NEW contact sheet, preview or new order is refused with
--   'The render queue is full right now. Please try again in a while.'  (the pages and the AI connector show it as it is).
-- Films already waiting keep their place and are made as usual. An order already under way, your approvals and retries are NEVER refused.
-- ONCE, BEFORE PART 2 (the first time only): in the SQL Editor paste ALL of supabase/migrations/20261124000100_queue_ceiling.sql and Run.
--   On its own it changes NOTHING (the brake is empty = off). If it says 'is not the one this change expects', STOP and tell CC1: nothing was changed.
--   It needs the Tuesday migrations (20261123000200, the 2-films-each cap); it is not yet in L-Ai main, so CC1 merges a8eae0f5 into main after Wednesday.
-- Then run the parts below one at a time. PART 1 any time (read-only, works before and after the migration). PART 2 sets the brake. PART 3 takes it off.
-- After PART 2 or 3, run PART 1 again: it must show the number you set, or 'off'.
-- FULL UNDO (only if CC1 asks): supabase/rollbacks/20261124000100_queue_ceiling_rollback.sql (puts both checks back exactly, removes the setting).
--   Run it FIRST, before any older undo (20261123000300, then 20261123000200): the 000200 undo does not know this file and would leave its setting behind (RENDERER 11:39).

-- PART 1, read-only check: the brake now, the line by type, the oldest wait, the render PC's last check-in.
select what, value from (
select 1 as n, 'queue brake' as what,
       coalesce((select (to_jsonb(s) ->> 'queue_ceiling') from public.ops_settings s where s.id), 'off') as value
union all
select 2, 'jobs waiting for the render PC',
       (select count(*) from public.jobs where state = 'queued' and run_on = 'house')::text || ' waiting: '
         || (select count(*) from public.jobs where state = 'queued' and run_on = 'house' and job_type = 'contact_sheet')::text || ' sheets, '
         || (select count(*) from public.jobs where state = 'queued' and run_on = 'house' and job_type = 'preview')::text || ' previews, '
         || (select count(*) from public.jobs where state = 'queued' and run_on = 'house' and job_type = 'final_render')::text || ' full films'
union all
select 3, 'longest wait in line (since it joined)',
       coalesce((select round(extract(epoch from now() - min(queued_at)) / 60)::text || ' min' from public.jobs where state = 'queued' and run_on = 'house'), 'none waiting')
union all
select 4, 'render PC last checked in',
       coalesce((select round(extract(epoch from now() - max(last_seen_at)) / 60)::text || ' min ago' from public.workers where enabled and last_seen_at is not null), 'never')
) t order by n;

-- PART 2, set the brake: 25 (use 15 if PART 1 shows 3 or more full films waiting). Needs the migration above: if it says
-- 'column "queue_ceiling" of relation "ops_settings" does not exist', run the migration first. The number is JOBS waiting, 1 to 100000 (0 is refused).
update public.ops_settings set queue_ceiling = 25 where id;

-- PART 3, take the brake off (new sheets and previews are accepted again at once; nothing else changes).
update public.ops_settings set queue_ceiling = null where id;

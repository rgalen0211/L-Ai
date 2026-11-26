-- SIGN-UP FLOOD FIX, the AFTER check (step 74's order, point 4). Read-only. Paste ALL and Run AFTER the migration 20261126000100.
-- Its FIRST row says PASS or STOP. On STOP send CC1 the rows below it. Before the migration it says STOP (that is expected then).
with c as (
  select 1 as n, 'the column join_attempts.confirmed_at is there' as what,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'join_attempts' and column_name = 'confirmed_at') as ok
  union all select 2, 'the trigger that records an opened email is on auth.users',
         exists (select 1 from pg_trigger where tgname = 'join_attempt_confirmed_trg' and tgrelid = 'auth.users'::regclass and not tgisinternal)
  union all select 3, 'join_reserve counts the day''s size by OPENED addresses',
         coalesce((select prosrc like '%interval ''1 day'' and confirmed_at is not null)%' from pg_proc where oid = to_regprocedure('public.join_reserve(text, text)')), false)
  union all select 4, 'join_reserve has the ceiling on asks',
         coalesce((select prosrc like '%join_asks_max%' from pg_proc where oid = to_regprocedure('public.join_reserve(text, text)')), false)
  union all select 5, 'nobody but the database can run the trigger function (anon, authenticated, service_role all refused)',
         coalesce((select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                          and not has_function_privilege('service_role', p.oid, 'execute')
                     from pg_proc p where p.oid = to_regprocedure('ryagram_private.join_attempt_confirmed()')), false)
)
select result, what, ok from (
  select 0 as n, case when bool_and(ok) then 'PASS: the flood fix is on, open sign-up again with step 47'
              else 'STOP: ' || count(*) filter (where not ok) || ' row(s) not as expected, send CC1 these rows' end as result, null::text as what, null::boolean as ok
  from c
  union all
  select n, null, what, ok from c
) t order by n;

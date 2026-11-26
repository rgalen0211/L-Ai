-- SIGN-UP FLOOD FIX (Ryan's lever, ONLY if a flood of made-up addresses hits; CC1 11-26 15:33; BUILDER branch builder-join-by-opened-1126).
-- WHEN (GEO's hourly launch watch): row 3 says LOOK (10 or more asked 20 to 60 min ago and 0 opened) AND row 2 shows the day near full.
-- TODAY'S FIRST MOVE stays the same: live step 48 closes sign-up at once. THIS STEP is what lets you OPEN IT AGAIN without the flood still
-- blocking real strangers: after it, the day's size counts only addresses that OPENED their email, so made-up ones no longer fill it.
-- FOUR FILES, ONE STATEMENT EACH (each is a whole 'Copy ALL', like steps 47 and 48):
--   74_join_by_opened.sql (THIS file): read-only counts, before and after.
--   74b_join_by_opened_check.sql: read-only, after the migration; its FIRST row says PASS or STOP.
--   74c_join_asks_max_set.sql and 74d_join_asks_max_clear.sql: optional, set and clear the ceiling on asks.
-- ORDER: (1) step 48 (sign-up OFF), if not already; (2) THIS file (read-only; note the numbers); (3) ONCE: paste ALL of
--   supabase/migrations/20261126000100_join_day_by_opened.sql into the SQL Editor and Run (if it says 'is not the one this change expects', STOP
--   and tell CC1: nothing was changed); (4) 74b: its FIRST row must say PASS; (5) THIS file again: row 1 says yes; (6) step 47 (sign-up ON) again.
-- WHAT IT DOES NOT DO: a flood from 7 or more networks can still reach the ceiling on ASKS (twice the day's size), and Resend's 100 a day can run out
-- first; if row 3 says LOOK again after this, step 48 again and tell CC1 (the levers that close it are a lower per-network limit and a captcha).
-- UNDO (only if CC1 asks): paste
--   supabase/rollbacks/20261126000100_join_day_by_opened_rollback.sql (the day's size then counts every address asked for again, as today).

-- read-only, any time (before or after the change): the fix, the two numbers, the day's asks and how many of them opened.
select what, value from (
select 1 as n, 'flood fix applied' as what,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'join_attempts' and column_name = 'confirmed_at')
            then 'yes' else 'no' end as value
union all
select 2, 'sign-up open (step 47 ON, step 48 OFF)',
       coalesce((select (to_jsonb(o) ->> 'join_open') from public.ops_settings o limit 1), 'no setting')
union all
select 3, 'the day''s size (join_daily_max, step 52)',
       coalesce((select (to_jsonb(o) ->> 'join_daily_max') from public.ops_settings o limit 1), '200 (no setting)')
union all
select 4, 'the ceiling on asks (join_asks_max)',
       coalesce((select (to_jsonb(o) ->> 'join_asks_max') from public.ops_settings o limit 1), 'empty = 2 x the day''s size')
union all
select 5, 'different addresses asked for in 24 hours',
       (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day')::text
union all
select 6, 'of them, opened their email (what the day''s size counts after the fix)',
       (select count(distinct j.email_hash) from public.join_attempts j where j.at > now() - interval '1 day'
          and exists (select 1 from auth.users u where u.email_confirmed_at is not null and btrim(coalesce(u.email, '')) <> ''
                        and encode(sha256(convert_to('ryagram-join:' || lower(btrim(u.email)), 'UTF8')), 'hex') = j.email_hash))::text
) t order by n;

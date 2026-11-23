-- SIGN-UP SIZE (Ryan's step, Wednesday 08:30 order step 3a, before 47_join_open_ON.sql): how many sign-up tries the join function accepts in total in any 24 hours.
-- The stranger past the number reads 'Sign-up is full for now. Please try again later.' Per-address and per-email limits are separate and unchanged. The number counts TRIES, not people: a stranger pressing Send again, an address that already has an account, your step-5 test join and the 09:00 walk each use one, so set about twice the people you want.
-- Your first-wave choice: (a) open to all at 10:00: skip this step, the size stays 200; (b) the walk plus about 10: set your number here.
-- Run the three parts in the SQL Editor, one at a time, in order. Needs migration 20261121000800 with the join_daily_max column (Tuesday step 1, A13):
-- if part 1 errors with 'column "join_daily_max" does not exist', STOP: skip this step (the size stays 200) and tell CC1.
-- Undo: run part 2 again with 200 (the built-in default); it takes seconds and no account changes. 'Any 24 hours' is rolling, not midnight to midnight:
-- tries from 08:30 Wednesday count until 08:30 Thursday. The test join in Wednesday step 5 uses one of the tries.

-- PART 1, read-only BEFORE check: the size now (200 unless someone changed it).
select join_daily_max as sign_up_size_now, join_open as sign_up_is_open from public.ops_settings;

-- PART 2, the change: replace 200 with the number you chose (a whole number, 1 or more; 0 would shut sign-up for everyone). Running it unchanged changes nothing.
update public.ops_settings set join_daily_max = 200;

-- PART 3, AFTER check: must show your number.
select join_daily_max as sign_up_size_now from public.ops_settings;

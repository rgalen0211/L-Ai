-- SIGN-UP SIZE (Ryan's step, Wednesday 08:30 order step 3a, before 47_join_open_ON.sql): how many different people (different email addresses) can sign up in total in any 24 hours.
-- The stranger past the number reads 'Sign-up is full for now. Please try again later.' The other limits are separate and unchanged: per network address 5 an hour and 10 a day, per email 3 a day. The number counts PEOPLE (different addresses), not tries: one person pressing Send again takes one place, not two, and is let through even on a full day (CONNECT cf9e1d2e); but an address that already has an account, your step-5 test join and the 09:00 walk addresses each take one place too, so add those to the number of new people you want.
-- Your first-wave choice: (a) open to all at 10:00: skip this step, the size stays 200; (b) the walk plus about 10: set your number here.
-- Run the three parts in the SQL Editor, one at a time, in order. Needs migration 20261121000800 with the join_daily_max column (Tuesday step 1, A13):
-- if part 1 errors with 'column "join_daily_max" does not exist', STOP: skip this step (the size stays 200) and tell CC1.
-- Undo: run part 2 again with 200 (the built-in default); it takes seconds and no account changes. 'Any 24 hours' is rolling, not midnight to midnight:
-- tries from 08:30 Wednesday count until 08:30 Thursday. The test join in Wednesday step 5 takes one place.
-- AFTER THE FLOOD FIX (only if live step 74 was run; its row 1 then says 'flood fix applied: yes'): the number counts only people who OPENED
-- their email, so made-up addresses no longer take places; asks are capped separately by join_asks_max (empty = 2 x this number; steps 74c
-- and 74d set and clear it). If you raise this number after step 74, the ask cap rises with it unless join_asks_max is set.

-- PART 1, read-only BEFORE check: the size now (200 unless someone changed it).
select join_daily_max as sign_up_size_now, join_open as sign_up_is_open from public.ops_settings;

-- PART 2, the change: replace 200 with the number you chose (a whole number, 1 or more; 0 turns away every NEW person, though anyone already holding a place still passes). Running it unchanged changes nothing.
update public.ops_settings set join_daily_max = 200;

-- PART 3, AFTER check: must show your number.
select join_daily_max as sign_up_size_now from public.ops_settings;

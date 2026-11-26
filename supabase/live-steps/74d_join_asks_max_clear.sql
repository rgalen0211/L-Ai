-- SIGN-UP FLOOD FIX, optional: the ceiling on asks back to its default (empty = 2 x the day's size). Check with step 74 (row 4).
update public.ops_settings set join_asks_max = null;

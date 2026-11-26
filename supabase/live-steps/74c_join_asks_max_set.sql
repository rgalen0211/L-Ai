-- SIGN-UP FLOOD FIX, optional lever (only after step 74 says 'flood fix applied: yes'): set the ceiling on ASKS, every different address asked for
-- in 24 hours, opened or not. A whole number; 0 turns away every NEW address. Running it unchanged sets 70. Check with step 74 (row 4). Undo: 74d.
update public.ops_settings set join_asks_max = 70;

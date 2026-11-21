-- SIGN-UP OPEN (Ryan's step, at launch, after 46_join_open_check.sql was all true, the join function is deployed and Auth email sending works): a stranger who joins is let in at once.
-- Needs the waiting switch OFF (live-step 21) for them to be ACTIVE; with it ON (step 20) they wait instead. Undo: 48_join_open_OFF.sql (seconds). Does not touch anyone who already has an account or is already waiting.
update public.ops_settings set join_open = true;
select join_open as flag_is_on, waiting_accounts as waiting_switch_is_on from public.ops_settings;

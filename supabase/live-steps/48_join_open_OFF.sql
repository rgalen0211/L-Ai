-- SIGN-UP CLOSED AGAIN: the undo of 47_join_open_ON.sql. join answers 'not open' again (unless the waiting switch is ON). Accounts that joined while it was open stay as they are.
update public.ops_settings set join_open = false;
select join_open as flag_is_on, waiting_accounts as waiting_switch_is_on from public.ops_settings;

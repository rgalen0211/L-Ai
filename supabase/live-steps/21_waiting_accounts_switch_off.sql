-- SWITCH WAITING ACCOUNTS OFF (the undo; nothing else needs undoing). Every check passes at once, so waiting accounts can use the app again; their rows stay as they are.
-- New accounts are recorded active while the switch is off. To let the people already waiting in, approve them on the waiting list, or turn the switch back on.
update public.ops_settings set waiting_accounts = false;
select waiting_accounts as switch_is_on from public.ops_settings;

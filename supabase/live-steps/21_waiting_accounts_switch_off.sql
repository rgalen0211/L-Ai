-- SWITCH WAITING ACCOUNTS OFF. What it does: new accounts are made OPEN again (recorded active) and the "Create an account" path closes (join answers "not open"). What it does NOT do: it does not
-- let anyone who is already WAITING in. A waiting account stays gated on purpose, switch on or off, so that switching off and on again can never let a waiting account buy credits or pair a computer.
-- To let the people already waiting in, approve them on the waiting list one by one, or run 22_waiting_accounts_open_all.sql.
update public.ops_settings set waiting_accounts = false;
select waiting_accounts as switch_is_on, (select count(*) from public.account_status where status = 'waiting') as still_waiting from public.ops_settings;

-- SWITCH WAITING ACCOUNTS ON (Ryan's step, after 19_waiting_accounts_after_check.sql was all true, the Edge Functions were redeployed, and the pages are live).
-- From now on a NEW account starts on the waiting list and sees only the waiting page. Every account that exists now stays active. Undo: 21_waiting_accounts_switch_off.sql (seconds).
update public.ops_settings set waiting_accounts = true;
select waiting_accounts as switch_is_on, (select count(*) from public.account_status where status = 'active') as active_accounts,
       (select count(*) from public.account_status where status = 'waiting') as waiting_accounts from public.ops_settings;

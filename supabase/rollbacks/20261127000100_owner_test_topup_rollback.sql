-- THE EXACT UNDO of migrations/20261127000100_owner_test_topup.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It drops the three admin calls, the owner list and the log. Credits already given and already taken back STAY in the credit ledger (it is append-only; nobody's balance changes).
-- WARNING: dropping the log forgets which top-ups were undone. To keep it, copy it out first: select * from ryagram_private.test_topups. Ends with gate_apply.
begin;
drop function public.admin_test_topup(text, int, text);
drop function public.admin_test_topup_undo(bigint, text);
drop function public.admin_test_topup_list();
drop table ryagram_private.test_topups;
drop table ryagram_private.test_topup_accounts;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

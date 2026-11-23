-- THE EXACT UNDO of migrations/20261123000600_welcome_credits.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It stops the trigger and drops the function, the setting and the once-per-address table. Credits already given STAY in the ledger (nobody loses them). WARNING: dropping the table forgets which addresses have had their welcome credits: if the
-- migration is applied again later, an address that already had them and verifies a NEW account would get them again. To keep the memory, copy it out first: select * from ryagram_private.welcome_credit_grants. Ends with gate_apply.
begin;
drop trigger welcome_credits_trg on auth.users;
drop function ryagram_private.welcome_credits_on_verified();
drop table ryagram_private.welcome_credit_grants;
alter table public.ops_settings drop column welcome_credits;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

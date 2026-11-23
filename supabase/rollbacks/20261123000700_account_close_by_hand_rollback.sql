-- THE UNDO of migrations/20261123000700_account_close_by_hand.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It drops the function and the closed_at column. ACCOUNTS ALREADY CLOSED STAY CLOSED: their login fields were cleared and cannot be put back (that is the
-- point of a close). After this undo their requests look open again in live step 58's row 11; copy the closed list out first if you need it:
--   select owner_id, requested_at, closed_at from public.account_deletion_requests where closed_at is not null;
begin;
drop function if exists public.account_close_by_hand(uuid);
alter table public.account_deletion_requests drop column if exists closed_at;
select ryagram_private.gate_apply();
commit;

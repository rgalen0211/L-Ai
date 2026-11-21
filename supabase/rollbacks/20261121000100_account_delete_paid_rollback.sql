-- THE EXACT UNDO OF migrations/20261121000100_account_delete_paid.sql (GEO 2026-11-21; CC1 12:36 G1). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Every function body below is COPIED by script from the file named beside it.
-- ORDER: run 20261121000400's rollback FIRST if 000400 was applied, and roll the delete-account function back to its previous commit BEFORE this (it calls both functions).
-- Nothing is restored: emails already redacted stay redacted, rows already marked stay marked. Grants are kept (create or replace keeps them; a dropped function takes its own).
begin;
drop function public.account_redact_contact(uuid, text);
drop function public.account_erase_paid_content(uuid);

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

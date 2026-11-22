-- THE EXACT UNDO OF migrations/20261121000100_account_delete_paid.sql (GEO 2026-11-21; CC1 12:36 G1). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Every function body below is COPIED by script from the file named beside it.
-- ORDER: run 20261121000400's rollback FIRST if 000400 was applied, and roll the delete-account function back to its previous commit BEFORE this (it calls both functions).
-- Nothing is restored: emails already redacted stay redacted, rows already marked stay marked. Grants are kept (create or replace keeps them; a dropped function takes its own).
begin;

-- GUARD (CC1 12:5x): while 000400's account_redact_contact is live (it erases the outbox mail), this undo STOPS in words and
-- changes nothing (the whole file is one transaction). Undo 000400 FIRST.
do $do$
begin
  if exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.account_redact_contact(uuid,text)') and p.prosrc like '%public.ops_outbox%') then
    raise exception 'Undo 000400 first: run rollbacks/20261121000400_retention_outbox_support_rollback.sql, then this file. Nothing was changed.';
  end if;
end $do$;

drop function public.account_redact_contact(uuid, text);
drop function public.account_erase_paid_content(uuid);

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- THE EXACT UNDO OF migrations/20261121000550_delete_revokes_ai.sql (GEO 2026-11-21; CC1 12:36 G1). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Every function body below is COPIED by script from the file named beside it.
-- ORDER: if 20261121000600 was applied, run ITS rollback FIRST (this one would otherwise drop 000600's lines too).
-- Nothing is restored: connections already revoked stay revoked (the person reconnects). Grants are kept (create or replace keeps them; a dropped function takes its own).
begin;

-- GUARD (CC1 12:5x): while 000600's account_request_deletion is live (it clears waiting prepared tables), this undo STOPS in
-- words and changes nothing (the whole file is one transaction): run now, it would strip 000600's lines too. Undo 000600 FIRST.
do $do$
begin
  if exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.account_request_deletion(uuid,text,text)') and p.prosrc like '%public.prepared_data%') then
    raise exception 'Undo 000600 first: run rollbacks/20261121000600_prepared_tombstone_rollback.sql, then this file. Nothing was changed.';
  end if;
end $do$;

create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- THE EXACT UNDO OF migrations/20261121000600_prepared_tombstone.sql (GEO 2026-11-21; CC1 12:36 G1). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Every function body below is COPIED by script from the file named beside it.
-- ORDER: run this BEFORE 20261121000550's rollback.
-- Nothing is restored: declarations and waiting tables already cleared stay cleared. Grants are kept (create or replace keeps them; a dropped function takes its own).
begin;
create or replace function public.mark_uploads_removed(p_dataset_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select d.id from public.datasets d
    where d.id = any (p_dataset_ids) and d.storage_path is not null and d.deleted_at is null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-uploads' and o.name = d.storage_path))
  update public.datasets set deleted_at = now(), status = 'rejected', storage_path = null, name = 'Deleted data',
         filename_label = null, ingest_report = null, mapping = null
    where id in (select id from gone);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
  -- GEO 11-21 (CC1 12:1x; GAMES 12:12): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. The auth ban stops a sign-in, but connect_actor reads only the connector's own tokens and grants:
  -- without this their AI could keep acting on the account. A revoked grant also refuses a refresh and a code exchange.
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

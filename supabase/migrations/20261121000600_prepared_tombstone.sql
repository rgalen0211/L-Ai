-- A DELETED UPLOAD KEEPS NONE OF THE AI'S DECLARATIONS; A PAYING CUSTOMER'S DELETE ALSO CLEARS THEIR AI'S WAITING TABLES AND
-- CONNECTIONS (GEO, 2026-11-21; CC1 12:0x; GEO's second review of train 3, MEDIUM 2 and LOW 3). NOT APPLIED: a PROPOSAL for CC1;
-- Ryan applies it AFTER 20261120000500_prepared_data.sql (it needs the prepared columns and table).
--   * mark_uploads_removed (its only version, 20261004000300, copied; one line added): the 'Deleted data' row also drops
--     prep_log (sources, publisher, notes, change log, who declared it) and prepared_from. Before, every deleted AI-prepared
--     upload kept them.
--   * account_request_deletion (its only version, 20260929000900, copied; lines added). The delete-account function calls it
--     only for an account with credit history, right after the erase step; the login then stays blocked until Ryan closes
--     the account by hand. Now it also empties that person's WAITING prepared tables (text gone, marked discarded) and
--     revokes their AI connection grants and tokens. GEO chose this function rather than a second copy of
--     account_erase_paid_content: that one lives on geo-pay-privacy-1121 (20261121000100), not on this branch. This one is
--     on main, has one version, and runs at the same moment of a paid delete.
-- Grants and owners are kept (create or replace). Service role only, as before.
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
         filename_label = null, ingest_report = null, mapping = null,
         prep_log = null, prepared_from = null      -- GEO 11-21: what an AI declared about a deleted upload goes with it (train 3 review MEDIUM 2)
    where id in (select id from gone);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
  -- GEO 11-21 (train 3 review LOW 3): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. Their waiting AI-prepared tables lose their text now (the rows go with the login later) ...
  update public.prepared_data set csv_text = '', state = 'discarded', decided_at = now(),
         label = 'Deleted', sources = '{}'::jsonb, change_log = '[]'::jsonb, measured = '{}'::jsonb, ai_name = null   -- none of the AI's declarations (GAMES 12:12 LOW)
    where owner_id = p_owner and state = 'waiting';
  -- ... and their AI connections are revoked now: the auth ban stops a sign-in, but connect_actor reads only the
  -- connector's own tokens and grants, so without this their AI could keep acting on the account (GEO 11-21).
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

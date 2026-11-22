-- A DELETED UPLOAD KEEPS NONE OF THE AI'S DECLARATIONS; A PAYING CUSTOMER'S DELETE ALSO CLEARS THEIR AI'S WAITING TABLES
-- (GEO, 2026-11-21; CC1 12:0x; GEO's second review of train 3, MEDIUM 2 and LOW 3). NOT APPLIED: a PROPOSAL for CC1;
-- Ryan applies it AFTER 20261120000500_prepared_data.sql (it needs the prepared columns and table) and AFTER
-- 20261121000550_delete_revokes_ai.sql (CC1 12:1x: version order; that file ends the person's AI connections on its own).
--   * mark_uploads_removed (its only version, 20261004000300, copied; one line added): the 'Deleted data' row also drops
--     prep_log (sources, publisher, notes, change log, who declared it) and prepared_from. Before, every deleted AI-prepared
--     upload kept them.
--   * account_request_deletion, COPIED FROM 000550's body (which already revokes the person's AI connections) with lines
--     added: that person's WAITING prepared tables lose their text and every AI declaration (label, sources, change log,
--     measured, AI name) and are marked discarded. delete-account calls it only for an account with credit history, right
--     after the erase step; the login then stays blocked until Ryan closes the account by hand. ORDER MATTERS: this body must
--     carry every line of 000550's, or applying 000600 after it would undo the revoke; test_prepared_data checks that.
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
  -- GEO 11-21 (CC1 12:1x; GAMES 12:12): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. The auth ban stops a sign-in, but connect_actor reads only the connector's own tokens and grants:
  -- without this their AI could keep acting on the account. A revoked grant also refuses a refresh and a code exchange.
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  -- GEO 11-21 (train 3 review LOW 3): their waiting AI-prepared tables lose their text and the AI's declarations now
  -- (the rows go with the login at Ryan's hand close).
  update public.prepared_data set csv_text = '', state = 'discarded', decided_at = now(),
         label = 'Deleted', sources = '{}'::jsonb, change_log = '[]'::jsonb, measured = '{}'::jsonb, ai_name = null   -- none of the AI's declarations (GAMES 12:12 LOW)
    where owner_id = p_owner and state = 'waiting';
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

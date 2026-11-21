-- Films made FROM a customer's upload go when the upload goes (WORKER 2026-11-21, GEO's privacy review M3).
--
-- Before: the hourly purge-uploads sweep removed the uploaded spreadsheet, but every contact sheet, preview, thumbnail and
-- receipt made from it stayed in Storage for good, so a customer deleted their data and a preview showing their values
-- frame by frame stayed in their films.
--
-- THE RULE (reversible; Ryan to confirm, as GEO asked 'decide the rule'):
--   * the person DELETED their data (Delete, then Recently deleted ran out or 'Delete forever'): every artifact of every
--     job that read it goes, the final film too: the film shows their data and they asked for it to be gone;
--   * 'Don't keep' or an unreadable file: the DRAFTS made from it go (contact sheets, previews and their thumbnails and
--     receipts), but a paid final film stays until its own 30 days end (render_orders_tick + M2): 'Don't keep' means
--     'don't keep my spreadsheet', not 'delete the film I paid for'.
--
-- The sweep LISTS what is due (upload_films_due_for_deletion), removes the files from Storage, then
-- mark_upload_films_removed marks an artifact (and a delivery that names it) deleted ONLY when storage.objects no longer
-- holds the file, the mark_uploads_removed rule, so a failed remove is retried on the next hourly run.
-- Nothing applied is edited. Service role only.

begin;

create function public.upload_films_due_for_deletion(p_limit int default 500)
returns table (artifact_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_path from public.artifacts a
  join public.jobs j on j.id = a.job_id
  join public.datasets d on d.id = j.dataset_id
  where a.deleted_at is null and d.source = 'upload' and d.deleted_at is not null
    and (d.delete_requested_at is not null or d.trashed_at is not null      -- the person deleted it: everything made from it
         or j.job_type <> 'final_render')                                    -- otherwise the drafts only
  order by a.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

create function public.mark_upload_films_removed(p_artifact_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select a.id from public.artifacts a
    join public.jobs j on j.id = a.job_id
    join public.datasets d on d.id = j.dataset_id
    where a.id = any (p_artifact_ids) and a.deleted_at is null and d.source = 'upload' and d.deleted_at is not null
      and (d.delete_requested_at is not null or d.trashed_at is not null or j.job_type <> 'final_render')
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path)),
  dl as (
    update public.render_deliveries set deleted_at = now()
      where artifact_id in (select id from gone) and deleted_at is null
      returning id)
  update public.artifacts set deleted_at = now() where id in (select id from gone);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[])
  from public, anon, authenticated;
grant execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[]) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
-- Check after running: supabase/live-steps/31_upload_films_gone_after_check.sql (every ok true).
commit;

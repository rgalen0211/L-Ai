-- Films made FROM a customer's upload go when the upload goes (WORKER 2026-11-21, GEO's privacy review M3;
-- r2 after CC1's 11:27 review and GEO's second review).
--
-- Before: the hourly purge-uploads sweep removed the uploaded spreadsheet, but every contact sheet, preview, thumbnail and
-- receipt made from it stayed in Storage for good, so a customer deleted their data and a preview showing their values
-- frame by frame stayed in their films.
--
-- THE RULE (reversible; Ryan to confirm, as GEO asked 'decide the rule'):
--   * the person DELETED their data (Delete, then Recently deleted ran out or 'Delete forever'): every file of every
--     finished job that read it goes, the final film too: the film shows their data and they asked for it to be gone;
--   * 'Don't keep' or an unreadable file: every file goes EXCEPT those of a final render whose delivery is still live
--     (the film, its thumbnail and its receipt stay until the delivery's own 30 days end and M2 removes the film; then
--     the rest go here). 'Don't keep' means 'don't keep my spreadsheet', not 'delete the film I paid for'. A final that
--     was rendered but NEVER delivered (the approval ran out, or it was declined) is treated as a draft: it goes (GEO).
--   * only FINISHED jobs (complete, failed, cancelled, editorial_action_required): a job still uploading cannot have a
--     file marked before it lands (CC1's MEDIUM).
--   * only the upload owner's own files (a.owner_id = d.owner_id; the version trigger already ties them, a cheap guard).
--
-- The sweep LISTS what is due (upload_films_due_for_deletion), removes the files from Storage, then
-- mark_upload_films_removed marks an artifact (and a delivery that names it) deleted ONLY when storage.objects no longer
-- holds the file, the mark_uploads_removed rule, so a failed remove is retried on the next hourly run.
-- Nothing applied is edited. Service role only.

begin;

create function ryagram_private.upload_film_due(a public.artifacts) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    join public.datasets d on d.id = j.dataset_id
    where j.id = a.job_id and a.deleted_at is null and a.owner_id = d.owner_id
      and d.source = 'upload' and d.deleted_at is not null
      and j.state in ('complete', 'failed', 'cancelled', 'editorial_action_required')
      and (d.delete_requested_at is not null or d.trashed_at is not null                 -- the person deleted it: everything
           or j.job_type <> 'final_render'                                               -- the drafts
           or not exists (select 1 from public.render_deliveries r                       -- a final with no live delivery
                          join public.artifacts f on f.id = r.artifact_id
                          where f.job_id = j.id and r.deleted_at is null)))
$$;

create function public.upload_films_due_for_deletion(p_limit int default 500)
returns table (artifact_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_path from public.artifacts a
  where a.deleted_at is null and ryagram_private.upload_film_due(a)
  order by random()                                       -- a batch whose remove keeps failing never starves the rest
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

create function public.mark_upload_films_removed(p_artifact_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select a.id from public.artifacts a
    where a.id = any (p_artifact_ids) and a.deleted_at is null and ryagram_private.upload_film_due(a)
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path)),
  dl as (
    update public.render_deliveries set deleted_at = now()
      where artifact_id in (select id from gone) and deleted_at is null
      returning id)
  update public.artifacts set deleted_at = now() where id in (select id from gone) and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function ryagram_private.upload_film_due(public.artifacts) from public, anon, authenticated, service_role;
revoke execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[])
  from public, anon, authenticated;
grant execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[]) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
-- Check after running: supabase/live-steps/31_upload_films_gone_after_check.sql (every ok true).
commit;

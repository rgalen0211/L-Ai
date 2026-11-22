-- AN UPLOAD THAT WAS NEVER FINISHED IS PURGED AFTER A DAY (GEO, 2026-11-21; CC1 11:3x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md L6).
-- NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Before: create_upload made the row and its open slot, the browser stored the
-- file, and if the tab closed before finish_upload the row kept uploaded_at null for good; no rule of uploads_due_for_deletion
-- matched it, so the file (the customer's data) stayed in Storage forever. Now the hourly purge-uploads sweep lists it a day
-- after the slot was made, removes the file, and mark_uploads_removed marks the row only once the file is really gone (that
-- also closes the slot: upload_slot_ok needs deleted_at is null, so a late file cannot land). No other change: the function
-- is copied from 20261027000200 with one condition added; grants are kept (create or replace). Service role only.
begin;
create or replace function public.uploads_due_for_deletion(p_limit int default 200)
returns table (dataset_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.storage_path from public.datasets d
  where d.source = 'upload' and d.storage_path is not null and d.deleted_at is null
    and (d.delete_requested_at is not null
         or d.trashed_at < now() - interval '7 days'
         or (d.retention = 'dont_keep'
             and (d.last_activity_at < now() - interval '7 days'
                  or exists (select 1 from public.jobs j where j.dataset_id = d.id and j.job_type = 'final_render' and j.state = 'complete')))
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day')
         -- GEO 11-21 (review L6): a slot whose upload was never finished (the tab closed before finish_upload) goes a day after
         -- it was made; created_at, not last_activity_at, so nothing can keep it alive
         or (d.uploaded_at is null and d.created_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- Follow-up to 20261004000200/0500 (WORKER's review of upload-worker-sql, 2026-10-05). NOT APPLIED.
--
-- The storage policy that lets the worker read an uploaded file (ryagram_private.worker_may_read_upload) checked
-- deleted_at but NOT delete_requested_at, nor that the upload is CONFIRMED, nor that the job belongs to the upload's
-- owner. A worker that held a job could therefore still read a file whose deletion had been requested after
-- worker_job_upload answered. It now has the same conditions as worker_job_upload:
--   * the dataset is an upload that is not deleted AND has no deletion requested (for BOTH ways in);
--   * reading its claimed INGEST (the file is not confirmed yet: that is what the ingest is for), or
--   * a job of the dataset's OWNER on a CONFIRMED upload (status approved, mapping present), in the same states
--     worker_job_upload answers for: claimed, running, validating, uploading.
-- Nothing else changes: same name, same signature, same grants.

begin;

create or replace function ryagram_private.worker_may_read_upload(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.datasets d join public.workers w on w.user_id = auth.uid() and w.enabled
    where d.storage_path = object_name and d.source = 'upload'
      and d.deleted_at is null and d.delete_requested_at is null
      and (exists (select 1 from public.dataset_ingests i
                   where i.dataset_id = d.id and i.state = 'claimed' and i.worker_user_id = w.user_id)
           or (d.status = 'approved' and d.mapping is not null
               and exists (select 1 from public.jobs j
                           where j.dataset_id = d.id and j.owner_id = d.owner_id and j.worker_user_id = w.user_id
                             and j.state in ('claimed', 'running', 'validating', 'uploading')))))
$$;

commit;

-- Upload your own data: the worker reads a CONFIRMED upload for a render job. NOT APPLIED.
-- Needs 20261004000200_uploads_schema.sql and 20261004000300_uploads_worker_and_sweep.sql first.
--
-- worker_job_upload(job) answers ONE question for the worker that holds that job: "which uploaded file is this job's
-- data, and what did the person confirm it means?" It returns the storage path (the storage policy lets the worker
-- read exactly that file while it holds the job), the format, the file's size and sha256, the person's CONFIRMED
-- mapping and geography, and the dataset's story name (u_<24 hex>). It returns nothing for a job that uses no upload.
--
-- It says NOTHING about the person's data: no values, no header names beyond the mapping's column numbers and
-- measure names the person typed, and not the file label. The worker turns file + mapping into a dataset inside the
-- job's own folder, draws the film, and deletes the folder.
--
-- Refused (42501) for anyone but the enabled worker that currently holds the job; an upload that was deleted, is not
-- confirmed, or is not the job owner's is a plain-worded error the worker reports as the job's failure.

begin;

create function public.worker_job_upload(p_job uuid)
returns table (dataset_id uuid, ref text, storage_path text, ext text, bytes bigint, sha256 text, geography text, mapping jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  j public.jobs;
  d public.datasets;
begin
  select * into j from public.jobs
    where id = p_job and worker_user_id = w.user_id and state in ('claimed', 'running', 'validating', 'uploading');
  if not found then
    raise exception 'This worker does not hold job %.', p_job using errcode = '42501';
  end if;
  if j.dataset_id is null then
    return;                                         -- a catalog film: there is no upload to read
  end if;
  select * into d from public.datasets x
    where x.id = j.dataset_id and x.owner_id = j.owner_id and x.source = 'upload';
  if not found then
    return;                                         -- the dataset is not an upload (nothing for this function to do)
  end if;
  if d.deleted_at is not null or d.delete_requested_at is not null or d.storage_path is null then
    raise exception 'The data this film uses has been deleted.' using errcode = '22023';
  end if;
  if d.status <> 'approved' or d.mapping is null or d.geography is null or d.ext is null or d.sha256 is null then
    raise exception 'The data this film uses has not been confirmed.' using errcode = '22023';
  end if;
  return query select d.id, 'u_' || substr(replace(d.id::text, '-', ''), 1, 24), d.storage_path, d.ext, d.bytes,
                      d.sha256, d.geography, d.mapping;
end $$;

revoke execute on function public.worker_job_upload(uuid) from public, anon;
grant execute on function public.worker_job_upload(uuid) to authenticated;       -- require_worker() is the gate, as for jobs

commit;

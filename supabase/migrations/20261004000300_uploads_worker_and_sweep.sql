-- Upload your own data, phase 1: the worker's side and the deletion sweep. NOT APPLIED.
-- Needs 20261004000200_uploads_schema.sql first.
--
-- THE WORKER'S CONTRACT (for WORKER and CC1; the same text is in supabase/README.md, "Uploads"):
--   claim_next_ingest()             -> one row (ingest_id, dataset_id, storage_path, ext, bytes) or none.
--                                      Download storage_path from the PRIVATE bucket ryagram-uploads with the
--                                      worker's own JWT (a policy allows exactly the claimed dataset).
--   report_ingest(ingest_id, report) report is the closed JSON below; sent once per file.
--   fail_ingest(ingest_id, code, detail)  code in too_large, unreadable, not_a_table, too_many_rows,
--                                      too_many_columns, unsupported, timeout, unknown; detail is a plain
--                                      sentence for the person (at most 300 characters, no values from the file).
--
--   report = { format: csv|tsv|xlsx|ods, sha256: <64 hex>, rows: int (<= 1,000,000),
--              columns: [ { index: 0..n-1, header: text<=80, kind: place|period|number|text, sample: [text<=40 x<=5] } ] (1..60),
--              guess: { place_index, period_index, value_indexes[], geography: us_states|us_counties|null,
--                       cadence: annual|monthly|null, wide: bool },
--              periods: { first, last, count } | null,
--              unmatched: { count: int, names: [text x<=20] },
--              state_column_index: int | null, sheet: text | null, sheets: [text x<=20] }
--   Nothing else is accepted. Samples are the person's own values, shown only to them while they confirm.
--
-- A file is read on the worker only: values only (no formulas evaluated, no macros, no external links),
-- with caps on unzipped size, sheets, rows and columns, and a time limit. A file that breaks a cap is
-- reported with fail_ingest, never with a partial report.

begin;

create function public.claim_next_ingest()
returns table (ingest_id uuid, dataset_id uuid, storage_path text, ext text, bytes bigint)
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  ctl public.control;
  lost public.dataset_ingests;
  i public.dataset_ingests;
begin
  for lost in
    select * from public.dataset_ingests where state = 'claimed' and lease_expires_at < now() for update skip locked
  loop
    update public.dataset_ingests set
        state = case when lost.attempt < 3 then 'queued' else 'failed' end,
        attempt = case when lost.attempt < 3 then lost.attempt + 1 else lost.attempt end,
        error_code = case when lost.attempt < 3 then null else 'worker_lost' end,
        error_detail = case when lost.attempt < 3 then null else 'The worker stopped while reading this file. Try uploading it again.' end,
        worker_user_id = null, lease_expires_at = null, updated_at = now()
      where id = lost.id;
    if lost.attempt >= 3 then
      update public.datasets set status = 'rejected' where id = lost.dataset_id;
    end if;
  end loop;

  select * into ctl from public.control where id;
  if not ctl.claims_enabled then return; end if;
  -- One piece of work at a time per worker: reading a file waits for a render in progress.
  if exists (select 1 from public.dataset_ingests x where x.worker_user_id = w.user_id and x.state = 'claimed')
     or exists (select 1 from public.jobs j where j.worker_user_id = w.user_id
                  and j.state in ('claimed', 'running', 'validating', 'uploading')) then
    return;
  end if;

  select x.* into i from public.dataset_ingests x
    join public.datasets d on d.id = x.dataset_id and d.deleted_at is null and d.delete_requested_at is null and d.uploaded_at is not null
    where x.state = 'queued'
    order by x.created_at, x.id
    for update of x skip locked
    limit 1;
  if not found then return; end if;
  update public.dataset_ingests set state = 'claimed', worker_user_id = w.user_id,
         lease_expires_at = now() + interval '15 minutes', updated_at = now() where id = i.id;
  return query select i.id, d.id, d.storage_path, d.ext, d.bytes from public.datasets d where d.id = i.dataset_id;
end $$;

create function public.report_ingest(p_ingest uuid, p_report jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  i public.dataset_ingests;
  d public.datasets;
begin
  select * into i from public.dataset_ingests where id = p_ingest and worker_user_id = w.user_id and state = 'claimed' for update;
  if not found then
    raise exception 'This worker does not hold ingest %.', p_ingest using errcode = '42501';
  end if;
  select * into d from public.datasets where id = i.dataset_id for update;
  if not ryagram_private.ingest_report_ok(p_report) or (p_report->>'format') is distinct from d.ext then
    raise exception 'The report is not in the agreed shape.' using errcode = '22023';
  end if;
  update public.datasets set ingest_report = p_report, sha256 = p_report->>'sha256',
         row_count = (p_report->>'rows')::bigint, last_activity_at = now() where id = d.id;
  update public.dataset_ingests set state = 'done', lease_expires_at = null, updated_at = now() where id = i.id;
end $$;

create function public.fail_ingest(p_ingest uuid, p_code text, p_detail text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers := ryagram_private.require_worker();
  i public.dataset_ingests;
begin
  select * into i from public.dataset_ingests where id = p_ingest and worker_user_id = w.user_id and state = 'claimed' for update;
  if not found then
    raise exception 'This worker does not hold ingest %.', p_ingest using errcode = '42501';
  end if;
  if p_code not in ('too_large', 'unreadable', 'not_a_table', 'too_many_rows', 'too_many_columns', 'unsupported', 'timeout', 'unknown') then
    raise exception 'Unknown failure code.' using errcode = '22023';
  end if;
  update public.dataset_ingests set state = 'failed', error_code = p_code,
         error_detail = left(regexp_replace(coalesce(p_detail, ''), '[[:cntrl:]]', ' ', 'g'), 300),
         lease_expires_at = null, updated_at = now() where id = i.id;
  update public.datasets set status = 'rejected', last_activity_at = now() where id = i.dataset_id;
end $$;

-- ---------------------------------------------------------------- the deletion sweep (service role)

-- Files that are due to go: the person asked, or Don't-keep and the final film is done / 7 days idle, or a
-- file that could not be read (a day later).
create function public.uploads_due_for_deletion(p_limit int default 200)
returns table (dataset_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.storage_path from public.datasets d
  where d.source = 'upload' and d.storage_path is not null and d.deleted_at is null
    and (d.delete_requested_at is not null
         or (d.retention = 'dont_keep'
             and (d.last_activity_at < now() - interval '7 days'
                  or exists (select 1 from public.jobs j where j.dataset_id = d.id and j.job_type = 'final_render' and j.state = 'complete')))
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- Marks datasets removed ONLY where the file is really gone from Storage, so a failed delete is retried.
-- What stays is a tombstone (id, hash, row count): no name, no sample values, no mapping.
create function public.mark_uploads_removed(p_dataset_ids uuid[]) returns int
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

revoke execute on function public.claim_next_ingest(), public.report_ingest(uuid, jsonb), public.fail_ingest(uuid, text, text)
  from public, anon;
grant execute on function public.claim_next_ingest(), public.report_ingest(uuid, jsonb), public.fail_ingest(uuid, text, text)
  to authenticated;                                   -- require_worker() is the gate, as for jobs
revoke execute on function public.uploads_due_for_deletion(int), public.mark_uploads_removed(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.uploads_due_for_deletion(int), public.mark_uploads_removed(uuid[]) to service_role;

commit;

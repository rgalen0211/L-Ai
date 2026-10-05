-- Uploads: "Recently deleted" for 7 days (Ryan, 2026-10-05, WEB-PER-ITEM-DELETE.md section 8). NOT APPLIED. For Claude's review.
-- Needs 20261004000200, 0300, 0500 and 0510 first.
--
-- Today request_dataset_deletion hides an upload and the sweeper removes its file within the hour. New rule:
--   * Delete -> the upload moves to RECENTLY DELETED (datasets.trashed_at). It cannot be used (not attached, not read by
--     the worker, not confirmed, no new job); the file stays in Storage so it can be RESTORED.
--   * restore_dataset(id) within 7 days brings it back as it was. The versions it was detached from stay detached
--     (non_restorable): restoring an upload does not silently re-link films.
--   * delete_dataset_forever(id) ("Delete forever now" in Recently deleted) starts the same removal as before
--     (delete_requested_at; the sweeper removes the file within the hour, the tombstone stays).
--   * 7 days after trashed_at the sweeper removes it permanently (uploads_due_for_deletion).
--   * Recently deleted COUNTS toward the 20-dataset / 100 MB quota until it is gone; "forever" frees it at once.
--   * UNCHANGED and still immediate: a "Don't keep" upload after its film / 7 idle days, a file that could not be read
--     (1 day), and deleting the whole account (storage_paths in account_deletion_check).
-- The front end must (a) stop listing trashed_at rows as uploads, (b) add the Recently deleted list, Restore and
-- Delete forever now, and (c) show the quota including them. None of that is built.

begin;

alter table public.datasets add column trashed_at timestamptz;
create index datasets_trashed_at_idx on public.datasets (trashed_at) where trashed_at is not null and deleted_at is null;

-- A trashed upload is not an open slot, and the worker may not read it (same conditions as 0510, plus "not trashed").
create or replace function ryagram_private.upload_slot_ok(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.datasets d
    where d.storage_path = object_name and d.owner_id = auth.uid() and d.source = 'upload'
      and d.uploaded_at is null and d.deleted_at is null and d.delete_requested_at is null and d.trashed_at is null)
$$;

create or replace function ryagram_private.worker_may_read_upload(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.datasets d join public.workers w on w.user_id = auth.uid() and w.enabled
    where d.storage_path = object_name and d.source = 'upload'
      and d.deleted_at is null and d.delete_requested_at is null and d.trashed_at is null
      and (exists (select 1 from public.dataset_ingests i
                   where i.dataset_id = d.id and i.state = 'claimed' and i.worker_user_id = w.user_id)
           or (d.status = 'approved' and d.mapping is not null
               and exists (select 1 from public.jobs j
                           where j.dataset_id = d.id and j.owner_id = d.owner_id and j.worker_user_id = w.user_id
                             and j.state in ('claimed', 'running', 'validating', 'uploading')))))
$$;

create or replace function public.worker_job_upload(p_job uuid)
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
  if d.deleted_at is not null or d.delete_requested_at is not null or d.trashed_at is not null or d.storage_path is null then
    raise exception 'The data this film uses has been deleted.' using errcode = '22023';
  end if;
  if d.status <> 'approved' or d.mapping is null or d.geography is null or d.ext is null or d.sha256 is null then
    raise exception 'The data this film uses has not been confirmed.' using errcode = '22023';
  end if;
  return query select d.id, 'u_' || substr(replace(d.id::text, '-', ''), 1, 24), d.storage_path, d.ext, d.bytes,
                      d.sha256, d.geography, d.mapping;
end $$;

create or replace function public.finish_upload(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  o record;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null and trashed_at is null for update;
  if not found then
    raise exception 'Dataset not found.' using errcode = 'PT404';
  end if;
  if d.uploaded_at is not null then
    return;                                            -- already finished: nothing to do
  end if;
  select (metadata->>'size')::bigint as size, metadata->>'mimetype' as mime into o
    from storage.objects where bucket_id = 'ryagram-uploads' and name = d.storage_path;
  if not found then
    raise exception 'The file didn''t arrive. Try uploading it again.' using errcode = '22023';
  end if;
  if o.size is null or o.size < 1 or o.size > 10485760 then
    raise exception 'That file is over the 10 MB limit.' using errcode = '22023';
  end if;
  update public.datasets set bytes = o.size, mime = left(o.mime, 100), uploaded_at = now(), last_activity_at = now() where id = d.id;
  insert into public.dataset_ingests (dataset_id, owner_id) values (d.id, me);
end $$;

create or replace function public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  problem text;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null and trashed_at is null for update;
  if not found then
    raise exception 'Dataset not found.' using errcode = 'PT404';
  end if;
  if d.ingest_report is null then
    raise exception 'We haven''t finished reading this file yet.' using errcode = '22023';
  end if;
  problem := ryagram_private.mapping_ok(p_mapping, d.ingest_report);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;
  update public.datasets set mapping = p_mapping, geography = p_mapping->>'geography', status = 'approved',
                             last_activity_at = now() where id = d.id;
end $$;

create or replace function public.attach_upload_to_version(p_version uuid, p_dataset uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  d public.datasets;
  ref text;
  cov text;
begin
  select * into v from public.versions where id = p_version and owner_id = me for update;
  if not found then raise exception 'Version not found.' using errcode = 'PT404'; end if;
  select * into d from public.datasets where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null
                                          and delete_requested_at is null and trashed_at is null;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if v.state not in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
    raise exception 'This version is % and can''t change its data. Make a new version.', v.state using errcode = '42501';
  end if;
  if d.status <> 'approved' then
    raise exception 'Confirm what the columns mean before using this data.' using errcode = '22023';
  end if;
  ref := 'u_' || substr(replace(d.id::text, '-', ''), 1, 24);
  cov := concat_ws(', ', case d.geography when 'us_counties' then 'U.S. counties' else 'U.S. states' end,
                   case when d.ingest_report->'periods' is not null and d.ingest_report->'periods' <> 'null'::jsonb
                        then (d.ingest_report->'periods'->>'first') || ' to ' || (d.ingest_report->'periods'->>'last') end,
                   d.mapping->>'cadence');
  update public.versions set dataset_id = d.id where id = v.id;
  update public.datasets set last_activity_at = now() where id = d.id;
  delete from public.version_sources where version_id = v.id and kind = 'upload' and dataset_ref <> ref;
  insert into public.version_sources (owner_id, version_id, kind, dataset_ref, title, publisher, source_url, coverage,
                                      licence_short, licence_full, position)
    values (me, v.id, 'upload', ref, d.name, 'Your data', '', cov, 'You confirm you may use this data', '',
            (select coalesce(max(position), 0) + 1 from public.version_sources where version_id = v.id))
    on conflict (version_id, dataset_ref) do update set title = excluded.title, coverage = excluded.coverage;
  return ref;
end $$;

create or replace function public.sync_version_sources(p_version uuid)
returns setof public.version_sources
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  wanted text[];
  ref text;
  c public.catalog_sources;
  d public.datasets;
  pos int := 0;
begin
  select * into v from public.versions where id = p_version and owner_id = me;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;

  if v.state in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
    select coalesce(array_agg(d2 order by first_pos), '{}') into wanted from (
      select d2, min(ord) as first_pos from (
        select (clip->>'dataset') as d2, ord
        from jsonb_array_elements(case when jsonb_typeof(v.story_spec #> '{sequence,clips}') = 'array'
                                       then v.story_spec #> '{sequence,clips}' else '[]'::jsonb end)
             with ordinality as t(clip, ord)
        where clip->>'kind' = 'render' and clip->>'dataset' is not null
      ) x group by d2) y;

    if coalesce(array_length(wanted, 1), 0) > 5 then
      raise exception 'A film can use up to 5 sources.' using errcode = '22023';
    end if;
    foreach ref in array wanted loop
      if ref ~ '^u_[0-9a-f]{24}$' then
        select * into d from public.datasets
          where owner_id = me and source = 'upload' and status = 'approved' and deleted_at is null and delete_requested_at is null and trashed_at is null
            and substr(replace(id::text, '-', ''), 1, 24) = substr(ref, 3);
        if not found then
          raise exception 'That uploaded data isn''t ready, or isn''t yours.' using errcode = '22023';
        end if;
      else
        select * into c from public.catalog_sources where id = ref;
        if not found then
          raise exception 'We don''t have data called "%".', left(ref, 60) using errcode = '22023';
        end if;
        if not c.runnable then
          raise exception 'We have "%", but can''t run it yet.', c.title using errcode = '22023';
        end if;
      end if;
    end loop;

    delete from public.version_sources
      where version_id = v.id and kind = 'catalog' and dataset_ref <> all (wanted);
    foreach ref in array wanted loop
      pos := pos + 1;
      if ref ~ '^u_[0-9a-f]{24}$' then
        update public.version_sources set position = pos where version_id = v.id and dataset_ref = ref;
      else
        select * into c from public.catalog_sources where id = ref;
        insert into public.version_sources (owner_id, version_id, kind, dataset_ref, title, publisher, source_url,
                                            coverage, licence_short, licence_full, position)
          values (me, v.id, 'catalog', ref, c.title, c.publisher, c.source_url, c.coverage, c.licence_short,
                  c.licence_full, pos)
          on conflict (version_id, dataset_ref) do update
            set title = excluded.title, publisher = excluded.publisher, source_url = excluded.source_url,
                coverage = excluded.coverage, licence_short = excluded.licence_short,
                licence_full = excluded.licence_full, position = excluded.position;
      end if;
    end loop;
  end if;

  return query select * from public.version_sources s where s.version_id = v.id order by s.position, s.created_at;
end $$;

-- Delete = move to Recently deleted. Same name and signature as before; same preconditions (no render may be using it).
-- Idempotent on an upload that is already in Recently deleted.
create or replace function public.request_dataset_deletion(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if d.trashed_at is not null then return; end if;
  if exists (select 1 from public.jobs j where j.dataset_id = d.id and j.state in ('queued', 'claimed', 'running', 'validating', 'uploading')) then
    raise exception 'A render that uses this data is still running. Wait for it to finish, or cancel it.' using errcode = '42501';
  end if;
  update public.versions set dataset_id = null, restorability = 'non_restorable' where dataset_id = d.id;
  delete from public.version_sources where kind = 'upload' and dataset_ref = 'u_' || substr(replace(d.id::text, '-', ''), 1, 24);
  update public.datasets set trashed_at = now() where id = d.id;
end $$;

-- Bring it back, within 7 days. It is exactly as it was (status, mapping, retention); films it was detached from stay detached.
create function public.restore_dataset(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null
      and trashed_at is not null and storage_path is not null for update;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if d.trashed_at <= now() - interval '7 days' then
    raise exception 'This was deleted more than 7 days ago and can''t be restored.' using errcode = '22023';
  end if;
  update public.datasets set trashed_at = null, last_activity_at = now() where id = d.id;
end $$;

-- "Delete forever now": only from Recently deleted (the running-render check lives in the first delete; it is repeated
-- here in case a job appeared since). The file is then removed by the sweeper within the hour.
create function public.delete_dataset_forever(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null
      and trashed_at is not null for update;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.jobs j where j.dataset_id = d.id and j.state in ('queued', 'claimed', 'running', 'validating', 'uploading')) then
    raise exception 'A render that uses this data is still running. Wait for it to finish, or cancel it.' using errcode = '42501';
  end if;
  update public.datasets set delete_requested_at = now() where id = d.id;
end $$;

-- The Recently deleted list: label, size, when it goes for good. Nothing else (no mapping, no report).
create function public.my_recently_deleted_uploads()
returns table (dataset_id uuid, label text, bytes bigint, trashed_at timestamptz, removed_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id, d.filename_label, d.bytes, d.trashed_at, d.trashed_at + interval '7 days'
  from public.datasets d
  where d.owner_id = auth.uid() and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null
    and d.trashed_at is not null and d.storage_path is not null
  order by d.trashed_at desc
$$;

-- The sweeper also removes what has sat in Recently deleted for 7 days.
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
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

revoke execute on function public.restore_dataset(uuid), public.delete_dataset_forever(uuid), public.my_recently_deleted_uploads()
  from public, anon;
grant execute on function public.restore_dataset(uuid), public.delete_dataset_forever(uuid), public.my_recently_deleted_uploads()
  to authenticated;
revoke execute on function public.uploads_due_for_deletion(int) from public, anon, authenticated, service_role;
grant execute on function public.uploads_due_for_deletion(int) to service_role;

commit;

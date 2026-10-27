-- THE EXACT UNDO of migrations/20261027000200_uploads_recently_deleted.sql (Q264 B). NOT a migration: it lives outside migrations/ so nothing applies it by itself. Generated from the database state BEFORE that step
-- (every function below is that state's own definition, as Postgres prints it), and TESTED on a scratch Postgres: applying the step and then this file gives back the identical schema, grants included.
-- Undo 20261027000300 (find data) FIRST if it has been applied: it builds on this file. Uploads now in Recently deleted are turned into plain deletion requests (the old behaviour: the sweeper removes them);
-- nothing in Recently deleted comes back as a usable upload.
begin;

update public.datasets set delete_requested_at = trashed_at where trashed_at is not null and delete_requested_at is null;

CREATE OR REPLACE FUNCTION public.attach_upload_to_version(p_version uuid, p_dataset uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                          and delete_requested_at is null;
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
                                      licence_short, licence_full, trust_label, position)
    values (me, v.id, 'upload', ref, d.name, 'Your data', '', cov, 'You confirm you may use this data', '', d.trust_label,
            (select coalesce(max(position), 0) + 1 from public.version_sources where version_id = v.id))
    on conflict (version_id, dataset_ref) do update set title = excluded.title, coverage = excluded.coverage, trust_label = excluded.trust_label;
  return ref;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb, p_trust_ack boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  problem text;
begin
  -- THE TICK IS REQUIRED BY THE DATABASE (CC1 2026-10-26 13:19): a page from before the tick box, or a script, cannot approve an upload the person never saw labelled. Ryan's Q234 sentence.
  if p_trust_ack is distinct from true then
    raise exception 'Tick the box to use this data anyway.' using errcode = '22023';
  end if;
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
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
                             trust_ack_at = coalesce(trust_ack_at, now()), last_activity_at = now() where id = d.id;
end $function$;

CREATE OR REPLACE FUNCTION public.finish_upload(p_dataset uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  o record;
begin
  select * into d from public.datasets
    where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
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
end $function$;

CREATE OR REPLACE FUNCTION public.request_dataset_deletion(p_dataset uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
begin
  select * into d from public.datasets where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null for update;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.jobs j where j.dataset_id = d.id and j.state in ('queued', 'awaiting_approval', 'claimed', 'running', 'validating', 'uploading')) then
    raise exception 'A render that uses this data is still running. Wait for it to finish, or cancel it.' using errcode = '42501';
  end if;
  update public.versions set dataset_id = null, restorability = 'non_restorable' where dataset_id = d.id;
  delete from public.version_sources where kind = 'upload' and dataset_ref = 'u_' || substr(replace(d.id::text, '-', ''), 1, 24);
  update public.datasets set delete_requested_at = now() where id = d.id;
end $function$;

CREATE OR REPLACE FUNCTION public.sync_version_sources(p_version uuid)
 RETURNS SETOF version_sources
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          where owner_id = me and source = 'upload' and status = 'approved' and deleted_at is null and delete_requested_at is null
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
end $function$;

CREATE OR REPLACE FUNCTION public.uploads_due_for_deletion(p_limit integer DEFAULT 200)
 RETURNS TABLE(dataset_id uuid, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.id, d.storage_path from public.datasets d
  where d.source = 'upload' and d.storage_path is not null and d.deleted_at is null
    and (d.delete_requested_at is not null
         or (d.retention = 'dont_keep'
             and (d.last_activity_at < now() - interval '7 days'
                  or exists (select 1 from public.jobs j where j.dataset_id = d.id and j.job_type = 'final_render' and j.state = 'complete')))
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$function$;

CREATE OR REPLACE FUNCTION public.worker_job_upload(p_job uuid)
 RETURNS TABLE(dataset_id uuid, ref text, storage_path text, ext text, bytes bigint, sha256 text, geography text, mapping jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION ryagram_private.upload_slot_ok(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.datasets d
    where d.storage_path = object_name and d.owner_id = auth.uid() and d.source = 'upload'
      and d.uploaded_at is null and d.deleted_at is null and d.delete_requested_at is null)
$function$;

CREATE OR REPLACE FUNCTION ryagram_private.worker_may_read_upload(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

drop function public.restore_dataset(uuid);
drop function public.delete_dataset_forever(uuid);
drop function public.my_recently_deleted_uploads();
drop index public.datasets_trashed_at_idx;
alter table public.datasets drop column trashed_at;

commit;

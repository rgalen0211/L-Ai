-- Upload your own data, phase 1 (CSV, TSV, Excel, OpenDocument): the person's side. NOT APPLIED.
-- Design: Ryagram-logs/proposals/WEB-UPLOAD-DATA.md (and WEB-PROMPT-FIRST-SOURCING.md, section 3).
-- The worker's side (reading the file, the queue it claims from) is the next file,
-- 20261004000300_uploads_worker_and_sweep.sql.
--
-- The flow:   create_upload -> (browser uploads the file to Storage) -> finish_upload -> [worker reads
--             it and reports what it found] -> confirm_dataset_mapping -> attach_upload_to_version.
--
-- Rules fixed here:
--   * 10 MiB per file; csv / tsv / xlsx / ods only; 20 datasets and 100 MiB per account.
--   * the file goes to its own PRIVATE bucket (ryagram-uploads), at <owner>/<dataset>/source.<ext>, only
--     into a slot create_upload made for that person, once.
--   * nothing is used until the person confirms a mapping (the closed shape below).
--   * a version's data must be one dataset in v1; its story names it as u_<first 24 hex of the id>.

begin;

-- ---------------------------------------------------------------- what a dataset now records

alter table public.datasets
  add column filename_label text check (char_length(filename_label) <= 200),
  add column ext text check (ext in ('csv', 'tsv', 'xlsx', 'ods')),
  add column mapping jsonb check (mapping is null or (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) <= 8192)),
  add column ingest_report jsonb check (ingest_report is null or (jsonb_typeof(ingest_report) = 'object' and pg_column_size(ingest_report) <= 32768)),
  add column geography text check (geography in ('us_states', 'us_counties')),
  add column uploaded_at timestamptz,
  add column last_activity_at timestamptz not null default now(),
  add column delete_requested_at timestamptz,
  add column deleted_at timestamptz;
create unique index datasets_storage_path_key on public.datasets (storage_path) where storage_path is not null;

-- A person's uploads waiting to be read. The worker claims from here (next file); owners may look.
create table public.dataset_ingests (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'claimed', 'done', 'failed')),
  attempt int not null default 1 check (attempt between 1 and 3),
  worker_user_id uuid references auth.users (id) on delete set null,
  lease_expires_at timestamptz,
  error_code text check (error_code in ('too_large', 'unreadable', 'not_a_table', 'too_many_rows', 'too_many_columns',
                                        'unsupported', 'timeout', 'worker_lost', 'unknown')),
  error_detail text check (char_length(error_detail) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dataset_ingests_one_active on public.dataset_ingests (dataset_id) where state in ('queued', 'claimed');
create index dataset_ingests_queue on public.dataset_ingests (created_at) where state = 'queued';
alter table public.dataset_ingests enable row level security;
revoke all on public.dataset_ingests from anon, authenticated, service_role;
grant select on public.dataset_ingests to authenticated;
create policy "Owners see their ingests" on public.dataset_ingests for select to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- the private bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ryagram-uploads', 'ryagram-uploads', false, 10485760,
          array['text/csv', 'text/tab-separated-values',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.oasis.opendocument.spreadsheet'])
  on conflict (id) do nothing;

-- The slot create_upload made for this person, not yet filled.
create function ryagram_private.upload_slot_ok(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.datasets d
    where d.storage_path = object_name and d.owner_id = auth.uid() and d.source = 'upload'
      and d.uploaded_at is null and d.deleted_at is null and d.delete_requested_at is null)
$$;

-- The worker may read an upload only while it holds the work that needs it: its claimed ingest, or a
-- render job on that dataset (the worker's own role; never a person's).
create function ryagram_private.worker_may_read_upload(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.datasets d join public.workers w on w.user_id = auth.uid() and w.enabled
    where d.storage_path = object_name and d.deleted_at is null
      and (exists (select 1 from public.dataset_ingests i
                   where i.dataset_id = d.id and i.state = 'claimed' and i.worker_user_id = w.user_id)
           or exists (select 1 from public.jobs j
                      where j.dataset_id = d.id and j.worker_user_id = w.user_id
                        and j.state in ('running', 'validating', 'uploading'))))
$$;
revoke execute on function ryagram_private.upload_slot_ok(text), ryagram_private.worker_may_read_upload(text)
  from public, anon;
grant execute on function ryagram_private.upload_slot_ok(text), ryagram_private.worker_may_read_upload(text) to authenticated;

create policy "People fill their own upload slot once" on storage.objects for insert to authenticated
  with check (bucket_id = 'ryagram-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text
              and ryagram_private.upload_slot_ok(name));
create policy "People read their uploads" on storage.objects for select to authenticated
  using (bucket_id = 'ryagram-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Worker reads the uploads it is working on" on storage.objects for select to authenticated
  using (bucket_id = 'ryagram-uploads' and ryagram_private.worker_may_read_upload(name));

-- ---------------------------------------------------------------- the person's functions

-- 1. A slot for a new upload. Quota and type checked before any byte moves.
create function public.create_upload(p_label text, p_ext text, p_bytes bigint, p_retention public.dataset_retention default null)
returns table (dataset_id uuid, storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  ext text := lower(coalesce(p_ext, ''));
  keep public.dataset_retention;
  new_id uuid := gen_random_uuid();
  path text;
begin
  perform pg_advisory_xact_lock(hashtextextended(me::text, 2027));
  if ext not in ('csv', 'tsv', 'xlsx', 'ods') then
    raise exception 'Ryagram reads CSV, TSV, Excel (.xlsx) and OpenDocument (.ods) files.' using errcode = '22023';
  end if;
  if coalesce(p_bytes, 0) < 1 then
    raise exception 'That file is empty.' using errcode = '22023';
  end if;
  if p_bytes > 10485760 then
    raise exception 'That file is over the 10 MB limit.' using errcode = '22023';
  end if;
  if (select count(*) from public.datasets d where d.owner_id = me and d.source = 'upload' and d.deleted_at is null
        and d.delete_requested_at is null) >= 20 then
    raise exception 'You have 20 uploaded datasets, the limit for now. Delete one to add another.' using errcode = '22023';
  end if;
  if coalesce((select sum(d.bytes) from public.datasets d where d.owner_id = me and d.source = 'upload'
                 and d.deleted_at is null and d.delete_requested_at is null), 0) + p_bytes > 104857600 then
    raise exception 'That would take you over 100 MB of uploaded data, the limit for now. Delete a file to make room.' using errcode = '22023';
  end if;
  keep := coalesce(p_retention, (select s.upload_retention from public.account_settings s where s.owner_id = me), 'keep');
  path := me::text || '/' || new_id::text || '/source.' || ext;
  insert into public.datasets (id, owner_id, name, source, storage_path, bytes, status, retention, filename_label, ext)
    values (new_id, me, left(regexp_replace(btrim(coalesce(p_label, '')), '[[:cntrl:]]', ' ', 'g'), 200)
            , 'upload', path, p_bytes, 'pending_validation', keep,
            left(regexp_replace(btrim(coalesce(p_label, '')), '[[:cntrl:]]', ' ', 'g'), 200), ext);
  return query select new_id, path;
exception when check_violation then
  raise exception 'Give the file a name of 1 to 200 characters.' using errcode = '22023';
end $$;

-- 2. The file arrived: check it is really in Storage, then queue it for the worker to read.
create function public.finish_upload(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- What a worker's report may contain (closed keys, bounded sizes). Used by report_ingest.
create function ryagram_private.ingest_report_ok(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb;
  s jsonb;
begin
  if r is null or jsonb_typeof(r) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in
       ('format', 'sheet', 'sheets', 'sha256', 'rows', 'columns', 'guess', 'periods', 'unmatched', 'state_column_index')) then
    return false;
  end if;
  if r->>'format' not in ('csv', 'tsv', 'xlsx', 'ods') then return false; end if;
  if (r->>'sha256') !~ '^[0-9a-f]{64}$' then return false; end if;
  -- Nested ifs, not AND/OR chains: SQL does not promise to stop at the first false.
  if coalesce(jsonb_typeof(r->'rows'), '') <> 'number' then return false; end if;
  if (r->>'rows')::numeric not between 0 and 1000000 then return false; end if;
  if coalesce(jsonb_typeof(r->'columns'), '') <> 'array' then return false; end if;
  if jsonb_array_length(r->'columns') not between 1 and 60 then return false; end if;
  for c in select * from jsonb_array_elements(r->'columns') loop
    if jsonb_typeof(c) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('index', 'header', 'kind', 'sample')) then return false; end if;
    if coalesce(jsonb_typeof(c->'index'), '') <> 'number' then return false; end if;
    if coalesce(jsonb_typeof(c->'header'), '') <> 'string' then return false; end if;
    if char_length(c->>'header') > 80 then return false; end if;
    if coalesce(c->>'kind', '') not in ('place', 'period', 'number', 'text') then return false; end if;
    if coalesce(jsonb_typeof(c->'sample'), '') <> 'array' then return false; end if;
    if jsonb_array_length(c->'sample') > 5 then return false; end if;
    for s in select * from jsonb_array_elements(c->'sample') loop
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 40 then return false; end if;
    end loop;
  end loop;
  -- column positions are exactly 0..n-1 in order
  if exists (select 1 from jsonb_array_elements(r->'columns') with ordinality t(col, ord)
             where (col->>'index')::int <> ord - 1) then return false; end if;
  if r ? 'sheets' then
    if jsonb_typeof(r->'sheets') <> 'array' then return false; end if;
    if jsonb_array_length(r->'sheets') > 20 then return false; end if;
    if exists (select 1 from jsonb_array_elements(r->'sheets') e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 60) then return false; end if;
  end if;
  if r ? 'sheet' and r->'sheet' <> 'null'::jsonb then
    if jsonb_typeof(r->'sheet') <> 'string' then return false; end if;
    if char_length(r->>'sheet') > 60 then return false; end if;
  end if;
  if r ? 'guess' then
    if jsonb_typeof(r->'guess') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'guess') k
               where k not in ('place_index', 'period_index', 'value_indexes', 'geography', 'cadence', 'wide')) then return false; end if;
    if coalesce(r->'guess'->>'geography', '') not in ('', 'us_states', 'us_counties') then return false; end if;
    if coalesce(r->'guess'->>'cadence', '') not in ('', 'annual', 'monthly') then return false; end if;
  end if;
  if r ? 'periods' and r->'periods' <> 'null'::jsonb then
    if jsonb_typeof(r->'periods') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'periods') k where k not in ('first', 'last', 'count')) then return false; end if;
  end if;
  if r ? 'unmatched' then
    if jsonb_typeof(r->'unmatched') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'unmatched') k where k not in ('count', 'names')) then return false; end if;
    if coalesce(jsonb_typeof(r->'unmatched'->'names'), '') <> 'array' then return false; end if;
    if jsonb_array_length(r->'unmatched'->'names') > 20 then return false; end if;
  end if;
  return true;
end $$;

-- The mapping a person may confirm (closed shape), judged against what the worker found.
create function ryagram_private.mapping_ok(m jsonb, r jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  n int := jsonb_array_length(r->'columns');
  v int;
  idx int[];
  used int[];
  st text;
begin
  if m is null or jsonb_typeof(m) <> 'object' then return 'The mapping is missing.'; end if;
  if exists (select 1 from jsonb_object_keys(m) k where k not in
       ('place_index', 'period_index', 'value_indexes', 'geography', 'cadence', 'state_index', 'state', 'measure_names', 'banded_index')) then
    return 'The mapping has something unexpected in it.';
  end if;
  if coalesce((r->'guess'->>'wide')::boolean, false) then
    return 'This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.';
  end if;
  if coalesce(jsonb_typeof(m->'place_index'), '') <> 'number' or coalesce(jsonb_typeof(m->'period_index'), '') <> 'number' then
    return 'Choose which column is the place and which is the period.';
  end if;
  if coalesce(m->>'geography', '') not in ('us_states', 'us_counties') then return 'Choose whether the places are U.S. states or counties.'; end if;
  if coalesce(m->>'cadence', '') not in ('annual', 'monthly') then return 'Choose whether the periods are yearly or monthly.'; end if;
  if coalesce(jsonb_typeof(m->'value_indexes'), '') <> 'array' then return 'Choose 1 to 8 columns of values.'; end if;
  if jsonb_array_length(m->'value_indexes') not between 1 and 8 then return 'Choose 1 to 8 columns of values.'; end if;
  if exists (select 1 from jsonb_array_elements(m->'value_indexes') e where jsonb_typeof(e) <> 'number') then
    return 'Choose 1 to 8 columns of values.';
  end if;
  select array_agg((e #>> '{}')::int) into idx from jsonb_array_elements(m->'value_indexes') e;
  used := array[(m->>'place_index')::int, (m->>'period_index')::int] || idx;
  if m ? 'state_index' and m->'state_index' <> 'null'::jsonb then
    if jsonb_typeof(m->'state_index') <> 'number' then return 'The state column isn''t a column.'; end if;
    used := used || (m->>'state_index')::int;
  end if;
  foreach v in array used loop
    if v < 0 or v >= n then return 'One of the chosen columns isn''t in the file.'; end if;
  end loop;
  if (select count(distinct x) from unnest(used) x) <> array_length(used, 1) then
    return 'Each column can only be used for one thing.';
  end if;
  if m->>'geography' = 'us_counties' then
    st := m->>'state';
    if (m->'state_index' is null or m->'state_index' = 'null'::jsonb) and st is null then
      return 'County names need a state. Choose the state, or the column that has it.';
    end if;
    if st is not null and st not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
                                     'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
                                     'UT','VT','VA','WA','WV','WI','WY') then
      return 'That isn''t a U.S. state.';
    end if;
  end if;
  if m ? 'banded_index' and m->'banded_index' <> 'null'::jsonb
     and (jsonb_typeof(m->'banded_index') <> 'number' or not ((m->>'banded_index')::int = any (idx))) then
    return 'The main column has to be one of the value columns.';
  end if;
  if m ? 'measure_names' and (jsonb_typeof(m->'measure_names') <> 'object'
       or exists (select 1 from jsonb_each(m->'measure_names') e
                  where e.key !~ '^[0-9]{1,2}$' or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 80
                        or not (e.key::int = any (idx)))) then
    return 'Each value column''s name needs 1 to 80 characters.';
  end if;
  return null;
end $$;
revoke execute on function ryagram_private.ingest_report_ok(jsonb), ryagram_private.mapping_ok(jsonb, jsonb)
  from public, anon, authenticated;

-- 3. The person confirms what the columns mean. Nothing can be used before this.
create function public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
  problem text;
begin
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
                             last_activity_at = now() where id = d.id;
end $$;

-- 4. Use an approved upload as a film's data. One uploaded dataset per version in v1: it becomes the
-- version's dataset (which is what lets a render job see it) and appears among its sources.
create function public.attach_upload_to_version(p_version uuid, p_dataset uuid) returns text
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
                                      licence_short, licence_full, position)
    values (me, v.id, 'upload', ref, d.name, 'Your data', '', cov, 'You confirm you may use this data', '',
            (select coalesce(max(position), 0) + 1 from public.version_sources where version_id = v.id))
    on conflict (version_id, dataset_ref) do update set title = excluded.title, coverage = excluded.coverage;
  return ref;
end $$;

-- 5. Delete an upload: it disappears at once; the file is removed by the sweeper (next file).
create function public.request_dataset_deletion(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  d public.datasets;
begin
  select * into d from public.datasets where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null for update;
  if not found then raise exception 'Dataset not found.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.jobs j where j.dataset_id = d.id and j.state in ('queued', 'claimed', 'running', 'validating', 'uploading')) then
    raise exception 'A render that uses this data is still running. Wait for it to finish, or cancel it.' using errcode = '42501';
  end if;
  update public.versions set dataset_id = null, restorability = 'non_restorable' where dataset_id = d.id;
  delete from public.version_sources where kind = 'upload' and dataset_ref = 'u_' || substr(replace(d.id::text, '-', ''), 1, 24);
  update public.datasets set delete_requested_at = now() where id = d.id;
end $$;

-- Opening a version's page keeps its sources in step with its story. This replaces the earlier
-- definition: an u_<id> dataset of the person's own, once approved, counts as a source too.
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
end $$;

-- A render job on a dataset counts as activity (the don't-keep sweeper reads it).
create function ryagram_private.jobs_touch_dataset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dataset_id is not null then
    update public.datasets set last_activity_at = now() where id = new.dataset_id;
  end if;
  return new;
end $$;
create trigger jobs_touch_dataset after insert on public.jobs for each row execute function ryagram_private.jobs_touch_dataset();

-- Deleting an account must remove uploads too.
create or replace function public.account_deletion_check(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  history boolean := false;
begin
  if to_regclass('public.credit_ledger') is not null then
    execute 'select exists (select 1 from public.credit_ledger where owner_id = $1)' into history using p_owner;
  end if;
  return jsonb_build_object(
    'active_jobs', (select count(*) from public.jobs where owner_id = p_owner
                      and state in ('queued', 'claimed', 'running', 'validating', 'uploading')),
    'has_credit_history', history,
    'storage_paths', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                                where o.bucket_id = 'ryagram-artifacts' and o.name like p_owner::text || '/%'), '[]'::jsonb),
    'upload_paths', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                               where o.bucket_id = 'ryagram-uploads' and o.name like p_owner::text || '/%'), '[]'::jsonb));
end $$;

revoke execute on function public.create_upload(text, text, bigint, public.dataset_retention),
  public.finish_upload(uuid), public.confirm_dataset_mapping(uuid, jsonb), public.attach_upload_to_version(uuid, uuid),
  public.request_dataset_deletion(uuid) from public, anon;
grant execute on function public.create_upload(text, text, bigint, public.dataset_retention),
  public.finish_upload(uuid), public.confirm_dataset_mapping(uuid, jsonb), public.attach_upload_to_version(uuid, uuid),
  public.request_dataset_deletion(uuid) to authenticated;
revoke execute on function ryagram_private.jobs_touch_dataset() from public, anon, authenticated;

commit;

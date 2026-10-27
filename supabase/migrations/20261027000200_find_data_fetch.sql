-- FIND DATA, STEP S1 (NEXT-CONNECT 137; Ryan 2026-10-26 09:38 'let's start putting time into the tool'): the database side of fetching a file from an ALLOWLISTED OFFICIAL host
-- into the existing upload pipeline. NOT APPLIED: a proposal for CC1. It needs 20261026000100 and 20261026000200 (the trust label and the tick) applied first.
-- Design: Ryagram-logs/proposals/CONNECT-FIND-DATA-DESIGN.md sections 3 to 5; the function that uses it is supabase/functions/source-fetch.
--
-- THE SHAPE. A fetched file is an ordinary upload row (source stays 'upload', so the private bucket, the worker's sandboxed reader, the mapping step, the 20-dataset / 100 MiB limits and the purge all
-- apply to it unchanged) with `origin = 'fetched'`, a RECEIPT row, and a trust label that the DATABASE works out from the host the file really came from. Nothing here takes a label from a caller:
-- the label comes from the `fetch_hosts` list (a reviewed list, like portals.yaml: adding a host is a data change CC1 reads), looked up by the FINAL address after redirects.
--
-- WHO CAN CALL WHAT. Only the service role (the source-fetch function after it has checked the person's sign-in). Nobody else has a grant on any table or function below, and a person's existing
-- rights on their own datasets are unchanged. A person can read their own receipt.
--
-- WHAT IT CHANGES IN WHAT EXISTS (each is tested): (1) datasets: three columns and the label rule 'an upload is unverified' now reads 'an UPLOADED upload is unverified' (a fetched file may carry the host's label);
-- (2) confirm_dataset_mapping: the tick is required for every label except Official (an Official source shows no warning, so there is nothing to tick); (3) attach_upload_to_version: a fetched dataset's
-- film source row carries the real publisher, the source address and the licence text instead of 'Your data'; (4) version_sources gains `fetched` so ONLY such a row may carry another label than 'unverified_user'.

begin;

-- ---------------------------------------------------------------- the reviewed list of hosts

create table public.fetch_hosts (
  host_suffix text primary key check (host_suffix ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(host_suffix) <= 100),
  publisher text not null check (char_length(publisher) between 1 and 120),
  label text not null check (label in ('official', 'published_by_others')),
  -- 'open' lets the file be PUBLISHED later (Official + open only); everything else stays private. Every seed row says 'unknown' until the licence wording is settled (Ryan / the attorney: a legal row).
  licence_class text not null default 'unknown' check (licence_class in ('open', 'restricted', 'unknown')),
  licence_text text not null default '' check (char_length(licence_text) <= 1000),
  active boolean not null default true,
  added_at timestamptz not null default now()
);
alter table public.fetch_hosts enable row level security;
revoke all on public.fetch_hosts from anon, authenticated, service_role;                         -- closed to everyone: fetch_host_for (a definer function) is the only reader

-- Phase 1: United States federal statistical and public-health agencies and a few intergovernmental statistics offices. A domain matches itself and its subdomains (census.gov, www2.census.gov).
-- No wildcard on '.gov' and none on a state or city: a host is added here by a reviewed change. licence_class stays 'unknown' for every row until the wording is settled, so nothing fetched is publishable yet.
insert into public.fetch_hosts (host_suffix, publisher, label) values
  ('census.gov', 'U.S. Census Bureau', 'official'),
  ('bls.gov', 'U.S. Bureau of Labor Statistics', 'official'),
  ('bea.gov', 'U.S. Bureau of Economic Analysis', 'official'),
  ('cdc.gov', 'U.S. Centers for Disease Control and Prevention', 'official'),
  ('fda.gov', 'U.S. Food and Drug Administration', 'official'),
  ('data.gov', 'Data.gov (U.S. General Services Administration)', 'official'),
  ('nass.usda.gov', 'USDA National Agricultural Statistics Service', 'official'),
  ('ers.usda.gov', 'USDA Economic Research Service', 'official'),
  ('nces.ed.gov', 'National Center for Education Statistics', 'official'),
  ('huduser.gov', 'HUD User (U.S. Department of Housing and Urban Development)', 'official'),
  ('eia.gov', 'U.S. Energy Information Administration', 'official'),
  ('epa.gov', 'U.S. Environmental Protection Agency', 'official'),
  ('noaa.gov', 'U.S. National Oceanic and Atmospheric Administration', 'official'),
  ('fiscaldata.treasury.gov', 'U.S. Department of the Treasury, Fiscal Data', 'official'),
  ('data.worldbank.org', 'World Bank', 'official'),
  ('stats.oecd.org', 'OECD', 'official');

-- ---------------------------------------------------------------- what a dataset now records

alter table public.datasets
  add column origin text not null default 'uploaded' check (origin in ('uploaded', 'fetched')),
  add column licence_class text check (licence_class in ('open', 'restricted', 'unknown')),
  add column publishable boolean not null default false;

-- (1) the label rule: only a person's OWN file is always 'unverified_user'; a fetched file carries the label of its host.
alter table public.datasets drop constraint datasets_upload_label_is_unverified;
alter table public.datasets
  add constraint datasets_uploaded_label_is_unverified check (origin <> 'uploaded' or source <> 'upload' or trust_label = 'unverified_user'),
  add constraint datasets_fetched_is_a_labelled_upload check (origin <> 'fetched' or (source = 'upload' and trust_label in ('official', 'published_by_others') and licence_class is not null)),
  add constraint datasets_uploaded_has_no_licence_class check (origin <> 'uploaded' or (licence_class is null and publishable = false)),
  add constraint datasets_publishable_means_official_and_open check (publishable = false or (origin = 'fetched' and trust_label = 'official' and licence_class = 'open'));

-- ---------------------------------------------------------------- the receipt and the attempts

create table public.dataset_fetches (
  dataset_id uuid primary key references public.datasets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  final_url text not null check (final_url ~ '^https://' and char_length(final_url) <= 2000),
  host text not null check (host ~ '^[a-z0-9.-]+$' and char_length(host) <= 253),
  http_status int not null check (http_status = 200),
  bytes bigint not null check (bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  retrieved_at timestamptz not null default now(),
  attempt_id uuid not null,                                                       -- the attempt that made it (set below, once fetch_attempts exists)
  publisher text not null,
  label text not null check (label in ('official', 'published_by_others')),
  label_rule text not null default 'listed_host' check (label_rule = 'listed_host'),
  licence_text text not null default '' check (char_length(licence_text) <= 2000),
  licence_source text not null check (licence_source in ('host_default', 'page')),
  licence_class text not null check (licence_class in ('open', 'restricted', 'unknown')),
  why text not null default '' check (char_length(why) <= 300),
  code_version text not null default '' check (char_length(code_version) <= 40)
);
alter table public.dataset_fetches enable row level security;
revoke all on public.dataset_fetches from anon, authenticated, service_role;
grant select on public.dataset_fetches to authenticated;
create policy "Owners read their fetch receipts" on public.dataset_fetches for select to authenticated using (owner_id = (select auth.uid()));

-- Every attempt, refused or not, counts toward the limits. The host only (never the full address: it can carry a token in its query).
create table public.fetch_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  host text not null check (host ~ '^[a-z0-9.-]+$' and char_length(host) <= 253),
  state text not null default 'started' check (state in ('started', 'stored', 'refused', 'failed')),
  reason text check (reason in ('off_list', 'not_https', 'redirect', 'too_big', 'too_slow', 'not_a_table', 'is_html', 'login', 'robots', 'http_error', 'unreadable', 'storage', 'quota')),
  created_at timestamptz not null default now()
);
create index fetch_attempts_owner_time on public.fetch_attempts (owner_id, created_at desc);
alter table public.fetch_attempts enable row level security;
revoke all on public.fetch_attempts from anon, authenticated, service_role;
alter table public.dataset_fetches add constraint dataset_fetches_attempt_fk foreign key (attempt_id) references public.fetch_attempts (id) on delete cascade;
create unique index dataset_fetches_one_per_attempt on public.dataset_fetches (attempt_id);

-- A fetched dataset ALWAYS has its receipt: checked at the end of the transaction, so even a bug in a function below cannot leave one without.
create function ryagram_private.fetched_dataset_has_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.origin = 'fetched' and not exists (select 1 from public.dataset_fetches f where f.dataset_id = new.id) then
    raise exception 'A fetched dataset needs its receipt.' using errcode = '23514';
  end if;
  return null;
end $$;
revoke execute on function ryagram_private.fetched_dataset_has_receipt() from public, anon, authenticated;       -- a trigger fires without the privilege; nobody needs to call it
create constraint trigger datasets_fetched_needs_receipt after insert or update on public.datasets
  deferrable initially deferred for each row execute function ryagram_private.fetched_dataset_has_receipt();

-- (4) a film's source row: only a row made from a FETCHED dataset may carry a label other than 'unverified_user'.
alter table public.version_sources add column fetched boolean not null default false;
alter table public.version_sources drop constraint version_sources_upload_label_is_unverified;
alter table public.version_sources
  add constraint version_sources_upload_label_rule check (kind <> 'upload' or (fetched and coalesce(trust_label, '') in ('official', 'published_by_others')) or (not fetched and trust_label is not distinct from 'unverified_user')),
  add constraint version_sources_only_uploads_are_fetched check (not fetched or kind = 'upload');

-- ---------------------------------------------------------------- the service role's functions

-- Which listed host (if any) an address belongs to: the LONGEST matching suffix, itself or a subdomain of it. No rows = not on the list.
create function public.fetch_host_for(p_host text) returns table (host_suffix text, publisher text, label text, licence_class text, licence_text text)
language sql stable security definer set search_path = '' as $$
  select h.host_suffix, h.publisher, h.label, h.licence_class, h.licence_text
  from public.fetch_hosts h
  where h.active and p_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(p_host) <= 253
    and (p_host = h.host_suffix or p_host like '%.' || h.host_suffix)
  order by char_length(h.host_suffix) desc
  limit 1
$$;

-- The one entry: is this person allowed to start another fetch right now? Writes the attempt and returns its id.
create function public.fetch_reserve(p_owner uuid, p_host text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 2027));
  if not exists (select 1 from auth.users u where u.id = p_owner) then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;
  if not exists (select 1 from public.fetch_host_for(p_host)) then
    raise exception 'That address is not on the list of official sources Ryagram can fetch from yet.' using errcode = '22023';
  end if;
  if (select count(*) from public.fetch_attempts a where a.owner_id = p_owner and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'That is 10 fetches in the last hour, the limit for now. Try again later.' using errcode = 'PT429';
  end if;
  if (select count(*) from public.fetch_attempts a where a.owner_id = p_owner and a.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'That is 30 fetches in the last day, the limit for now. Try again tomorrow.' using errcode = 'PT429';
  end if;
  if (select count(*) from public.datasets d where d.owner_id = p_owner and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null) >= 20 then
    raise exception 'You have 20 uploaded datasets, the limit for now. Delete one to add another.' using errcode = '22023';
  end if;
  insert into public.fetch_attempts (owner_id, host) values (p_owner, p_host) returning fetch_attempts.id into id;
  return id;
end $$;

-- A refused or failed fetch still counts; this records why (a closed list).
create function public.fetch_fail(p_attempt uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fetch_attempts set state = case when p_reason in ('storage', 'unreadable', 'http_error', 'too_slow') then 'failed' else 'refused' end, reason = p_reason
    where id = p_attempt and state = 'started';
  if not found then
    raise exception 'Fetch not found.' using errcode = 'PT404';
  end if;
end $$;

-- The file has been downloaded and checked: make the dataset and its receipt, and hand back the slot to put the bytes in. The LABEL IS NOT AN ARGUMENT: it is looked up from the final address.
create function public.fetch_register(p_attempt uuid, p_owner uuid, p_final_url text, p_ext text, p_bytes bigint, p_sha256 text, p_name text,
                                      p_licence_text text, p_why text, p_code_version text)
returns table (dataset_id uuid, storage_path text, trust_label text, publisher text, licence_class text)
language plpgsql security definer set search_path = '' as $$
declare
  a public.fetch_attempts;
  host text;
  h record;
  ext text := lower(coalesce(p_ext, ''));
  keep public.dataset_retention;
  new_id uuid := gen_random_uuid();
  path text;
  page_licence text := left(regexp_replace(btrim(coalesce(p_licence_text, '')), '[[:cntrl:]]', ' ', 'g'), 2000);
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '[[:cntrl:]]', ' ', 'g'), 200);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 2027));
  select * into a from public.fetch_attempts where id = p_attempt and owner_id = p_owner and state = 'started' for update;
  if not found then
    raise exception 'Fetch not found.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.dataset_fetches f where f.attempt_id = p_attempt) then
    raise exception 'Fetch not found.' using errcode = 'PT404';                          -- one attempt makes one dataset
  end if;
  if p_final_url !~ '^https://[a-z0-9.-]+(:443)?(/|$)' then
    raise exception 'Only https addresses are kept.' using errcode = '22023';
  end if;
  host := substring(p_final_url from '^https://([a-z0-9.-]+)');
  select * into h from public.fetch_host_for(host);                                     -- the label comes from HERE, from the address the bytes really came from
  if not found then
    raise exception 'That address is not on the list of official sources Ryagram can fetch from yet.' using errcode = '22023';
  end if;
  if ext not in ('csv', 'tsv', 'xlsx', 'ods') then
    raise exception 'Ryagram reads CSV, TSV, Excel (.xlsx) and OpenDocument (.ods) files.' using errcode = '22023';
  end if;
  if char_length(nm) < 1 then
    raise exception 'Give the file a name of 1 to 200 characters.' using errcode = '22023';
  end if;
  if coalesce(p_bytes, 0) < 1 then
    raise exception 'That file is empty.' using errcode = '22023';
  end if;
  if p_bytes > 10485760 then
    raise exception 'That file is over the 10 MB limit.' using errcode = '22023';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The file''s hash is not valid.' using errcode = '22023';
  end if;
  if (select count(*) from public.datasets d where d.owner_id = p_owner and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null) >= 20 then
    raise exception 'You have 20 uploaded datasets, the limit for now. Delete one to add another.' using errcode = '22023';
  end if;
  if coalesce((select sum(d.bytes) from public.datasets d where d.owner_id = p_owner and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null), 0) + p_bytes > 104857600 then
    raise exception 'That would take you over 100 MB of uploaded data, the limit for now. Delete a file to make room.' using errcode = '22023';
  end if;
  keep := coalesce((select s.upload_retention from public.account_settings s where s.owner_id = p_owner), 'keep');
  path := p_owner::text || '/' || new_id::text || '/source.' || ext;
  insert into public.datasets (id, owner_id, name, source, storage_path, bytes, status, retention, filename_label, ext, origin, trust_label, licence_class, publishable)
    values (new_id, p_owner, nm, 'upload', path, p_bytes, 'pending_validation', keep, nm, ext, 'fetched', h.label, h.licence_class,
            h.label = 'official' and h.licence_class = 'open');
  insert into public.dataset_fetches (dataset_id, owner_id, final_url, host, http_status, bytes, sha256, attempt_id, publisher, label, licence_text, licence_source, licence_class, why, code_version)
    values (new_id, p_owner, p_final_url, host, 200, p_bytes, p_sha256, p_attempt, h.publisher, h.label,
            case when page_licence <> '' then page_licence else h.licence_text end,
            case when page_licence <> '' then 'page' else 'host_default' end,
            h.licence_class,                                                        -- a licence line read off a page is KEPT as text, but never raises the class
            left(regexp_replace(btrim(coalesce(p_why, '')), '[[:cntrl:]]', ' ', 'g'), 300), left(coalesce(p_code_version, ''), 40));
  return query select new_id, path, h.label, h.publisher, h.licence_class;
end $$;

-- The bytes are in the person's slot: check they really are, then queue the file for the worker (the same hand-over as finish_upload).
create function public.fetch_finish(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.datasets;
  f public.dataset_fetches;
  o record;
begin
  select * into d from public.datasets where id = p_dataset and origin = 'fetched' and deleted_at is null and delete_requested_at is null for update;
  if not found then
    raise exception 'Dataset not found.' using errcode = 'PT404';
  end if;
  if d.uploaded_at is not null then
    return;
  end if;
  select * into f from public.dataset_fetches where dataset_id = d.id;
  select (metadata->>'size')::bigint as size, metadata->>'mimetype' as mime into o from storage.objects where bucket_id = 'ryagram-uploads' and name = d.storage_path;
  if not found then
    raise exception 'The file didn''t arrive.' using errcode = '22023';
  end if;
  if o.size is distinct from f.bytes then
    raise exception 'The stored file is not the size that was fetched.' using errcode = '22023';
  end if;
  update public.datasets set bytes = o.size, mime = left(o.mime, 100), sha256 = f.sha256, uploaded_at = now(), last_activity_at = now() where id = d.id;
  insert into public.dataset_ingests (dataset_id, owner_id) values (d.id, d.owner_id);
  update public.fetch_attempts set state = 'stored' where id = f.attempt_id and state = 'started';
end $$;

-- The bytes could not be stored: the unfinished dataset and its receipt go (the attempt stays, and counts).
create function public.fetch_abort(p_dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.datasets where id = p_dataset and origin = 'fetched' and uploaded_at is null;
  if not found then
    raise exception 'Dataset not found.' using errcode = 'PT404';
  end if;
end $$;

revoke execute on function public.fetch_host_for(text), public.fetch_reserve(uuid, text), public.fetch_fail(uuid, text),
  public.fetch_register(uuid, uuid, text, text, bigint, text, text, text, text, text), public.fetch_finish(uuid), public.fetch_abort(uuid) from public, anon, authenticated;
grant execute on function public.fetch_host_for(text), public.fetch_reserve(uuid, text), public.fetch_fail(uuid, text),
  public.fetch_register(uuid, uuid, text, text, bigint, text, text, text, text, text), public.fetch_finish(uuid), public.fetch_abort(uuid) to service_role;

-- ---------------------------------------------------------------- (2) the tick: required for every label except Official

drop function public.confirm_dataset_mapping(uuid, jsonb, boolean);
create function public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb, p_trust_ack boolean) returns void
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
  -- THE TICK IS REQUIRED BY THE DATABASE for every label except Official (an Official source shows no warning, so there is nothing to tick). Ryan's Q234 sentence.
  if d.trust_label <> 'official' and p_trust_ack is distinct from true then
    raise exception 'Tick the box to use this data anyway.' using errcode = '22023';
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
end $$;
revoke execute on function public.confirm_dataset_mapping(uuid, jsonb, boolean) from public, anon;
grant execute on function public.confirm_dataset_mapping(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- (3) a film's source row for a fetched dataset

create or replace function public.attach_upload_to_version(p_version uuid, p_dataset uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  d public.datasets;
  f public.dataset_fetches;
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
  select * into f from public.dataset_fetches where dataset_id = d.id;                   -- found only for a fetched dataset
  ref := 'u_' || substr(replace(d.id::text, '-', ''), 1, 24);
  cov := concat_ws(', ', case d.geography when 'us_counties' then 'U.S. counties' else 'U.S. states' end,
                   case when d.ingest_report->'periods' is not null and d.ingest_report->'periods' <> 'null'::jsonb
                        then (d.ingest_report->'periods'->>'first') || ' to ' || (d.ingest_report->'periods'->>'last') end,
                   d.mapping->>'cadence');
  update public.versions set dataset_id = d.id where id = v.id;
  update public.datasets set last_activity_at = now() where id = d.id;
  delete from public.version_sources where version_id = v.id and kind = 'upload' and dataset_ref <> ref;
  insert into public.version_sources (owner_id, version_id, kind, dataset_ref, title, publisher, source_url, coverage,
                                      licence_short, licence_full, trust_label, fetched, position)
    values (me, v.id, 'upload', ref, d.name,
            case when f.dataset_id is null then 'Your data' else f.publisher end,
            case when f.dataset_id is null then '' else f.final_url end, cov,
            case when f.dataset_id is null then 'You confirm you may use this data'
                 else 'Retrieved ' || to_char(f.retrieved_at at time zone 'utc', 'YYYY-MM-DD') || ' from ' || f.host end,
            case when f.dataset_id is null then '' else f.licence_text end,
            d.trust_label, f.dataset_id is not null,
            (select coalesce(max(position), 0) + 1 from public.version_sources where version_id = v.id))
    on conflict (version_id, dataset_ref) do update set title = excluded.title, coverage = excluded.coverage, trust_label = excluded.trust_label;
  return ref;
end $$;
revoke execute on function public.attach_upload_to_version(uuid, uuid) from public, anon;
grant execute on function public.attach_upload_to_version(uuid, uuid) to authenticated;

commit;

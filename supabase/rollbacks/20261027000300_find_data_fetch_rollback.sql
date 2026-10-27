-- FIND DATA S1: the exact undo of supabase/migrations/20261027000300_find_data_fetch.sql (NEXT-CONNECT 137). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every fetched dataset (their receipts and the film source rows made from them) and the record of fetch attempts and the host list, and puts back the trust-label state (20261026000100, 20261026000200 and the Recently-deleted 20261027000200):
-- the two-label rule on uploads and attach_upload_to_version always writing 'Your data' (confirm_dataset_mapping was never changed by this migration). The bytes of fetched files stay in the private bucket until
-- the purge removes them (a deleted dataset row is what the purge looks for); Ryan can remove them by hand.
begin;

delete from public.version_sources where fetched;
update public.versions set dataset_id = null where dataset_id in (select id from public.datasets where origin = 'fetched');      -- a version and a job stop pointing at a fetched dataset before it goes
update public.jobs set dataset_id = null where dataset_id in (select id from public.datasets where origin = 'fetched');
delete from public.datasets where origin = 'fetched';

drop trigger if exists datasets_fetched_needs_receipt on public.datasets;
drop function if exists ryagram_private.fetched_dataset_has_receipt();
drop function if exists public.fetch_abort(uuid);
drop function if exists public.fetch_finish(uuid);
drop function if exists public.fetch_register(uuid, uuid, text, text, bigint, text, text, text, text, text);
drop function if exists public.fetch_fail(uuid, text);
drop function if exists public.fetch_reserve(uuid, text);
drop function if exists public.fetch_host_for(text);
drop table if exists public.dataset_fetches;
drop table if exists public.fetch_attempts;
drop table if exists public.fetch_hosts;

alter table public.version_sources drop constraint version_sources_upload_label_rule, drop constraint version_sources_only_uploads_are_fetched;
alter table public.version_sources drop column fetched;
alter table public.version_sources add constraint version_sources_upload_label_is_unverified check (kind <> 'upload' or trust_label is not distinct from 'unverified_user');

alter table public.datasets drop constraint datasets_uploaded_label_is_unverified, drop constraint datasets_fetched_is_a_labelled_upload,
  drop constraint datasets_uploaded_has_no_licence_class, drop constraint datasets_publishable_means_official_and_open;
alter table public.datasets drop column publishable, drop column licence_class, drop column origin;
alter table public.datasets add constraint datasets_upload_label_is_unverified check (source <> 'upload' or trust_label = 'unverified_user');

-- attach_upload_to_version as 20261027000200 (Recently deleted) left it
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
                                      licence_short, licence_full, trust_label, position)
    values (me, v.id, 'upload', ref, d.name, 'Your data', '', cov, 'You confirm you may use this data', '', d.trust_label,
            (select coalesce(max(position), 0) + 1 from public.version_sources where version_id = v.id))
    on conflict (version_id, dataset_ref) do update set title = excluded.title, coverage = excluded.coverage, trust_label = excluded.trust_label;
  return ref;
end $$;
revoke execute on function public.attach_upload_to_version(uuid, uuid) from public, anon;
grant execute on function public.attach_upload_to_version(uuid, uuid) to authenticated;

commit;

-- TRUST LABEL ON EVERY UPLOAD (NEXT-CONNECT 125's sibling: find-data step S0; Ryan 2026-10-26 09:38 and 12:12; RULINGS 2026-10-26 "Unofficial data sources"). NOT APPLIED: a proposal for CC1.
-- Design: Ryagram-logs/proposals/CONNECT-FIND-DATA-DESIGN.md section 4 and 5 (S0).
--
-- WHAT IT DOES. Every dataset now carries a TRUST LABEL, computed by the SERVER, never by a client or an AI: 'official', 'published_by_others' or 'unverified_user'. Today only uploads exist, and an
-- upload is ALWAYS 'unverified_user' (a CHECK enforces it, so even a bug in a definer function cannot make an upload look official). The film's source row (version_sources) carries the same label, so the
-- delivery page, the method note and the receipt can show it. The existing "confirm what the columns mean" step is the person's "use it anyway" press: it now records WHEN (trust_ack_at), and a CHECK says an
-- approved upload always has that moment. The screens that show the label and the warning, and the label names and warning wording (legal wording: Ryan's and the attorney's), are WEB's and Ryan's.
-- WHAT IT DOES NOT DO. It changes no grant (a person has SELECT on their own datasets and version_sources already, so the new columns are readable; nobody can UPDATE them), no function signature, and
-- nothing about fetching (find-data S1 onward).

begin;

alter table public.datasets
  add column trust_label text not null default 'unverified_user' check (trust_label in ('official', 'published_by_others', 'unverified_user')),
  add column trust_ack_at timestamptz;

-- Uploads already approved before this (none on live: uploads are off) count as acknowledged at their last activity.
update public.datasets set trust_ack_at = coalesce(last_activity_at, created_at) where source = 'upload' and status = 'approved' and trust_ack_at is null;

alter table public.datasets
  add constraint datasets_upload_label_is_unverified check (source <> 'upload' or trust_label = 'unverified_user'),
  add constraint datasets_approved_upload_was_acknowledged check (source <> 'upload' or status <> 'approved' or trust_ack_at is not null);

alter table public.version_sources
  add column trust_label text check (trust_label is null or trust_label in ('official', 'published_by_others', 'unverified_user'));
update public.version_sources set trust_label = 'unverified_user' where kind = 'upload';
alter table public.version_sources
  add constraint version_sources_upload_label_is_unverified check (kind <> 'upload' or trust_label is not distinct from 'unverified_user');      -- NULL is refused too

-- The person's "use it anyway": confirming the mapping records the moment (same body as before, one column more).
create or replace function public.confirm_dataset_mapping(p_dataset uuid, p_mapping jsonb) returns void
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
  -- This button IS the "use it anyway" press: the screen that shows it also shows the trust label and its warning (WEB). The moment is recorded.
  update public.datasets set mapping = p_mapping, geography = p_mapping->>'geography', status = 'approved',
                             trust_ack_at = coalesce(trust_ack_at, now()), last_activity_at = now() where id = d.id;
end $$;

-- A film's source row carries the label (same body as before, one column more).
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
end $$;

-- Same privileges as before: these two keep their grants, because create or replace keeps them; stated again so a reader sees them.
revoke execute on function public.confirm_dataset_mapping(uuid, jsonb), public.attach_upload_to_version(uuid, uuid) from public, anon;
grant execute on function public.confirm_dataset_mapping(uuid, jsonb), public.attach_upload_to_version(uuid, uuid) to authenticated;

commit;

-- AI-PREPARED DATA: THE AI HANDS RYAGRAM A TABLE IT RESEARCHED (CONNECT, 2026-11-20; Q634, Ryan's ChatGPT walk: "median age by US state 2010-2023"; design: proposals/CONNECT-FIND-DATA-DESIGN.md section 8 and
-- proposals/CONNECT-AI-DATA-HANDOFF-1120.md). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- WHAT IT DOES. The person's own AI may send a small table (place, year, value, ... as CSV text, at most 200 KB) with the sources it used (https addresses), the licence, the units and a short change log. It lands in a CLOSED
-- staging table, public.prepared_data, as inert text: it is NOT a dataset, it holds no file, and NO connector function can accept, confirm, attach or use it. The signed-in PERSON sees it in the app ("Prepared by your AI"),
-- previews it, and presses Accept; THEIR browser then runs today's exact upload path (create_upload -> upload -> finish_upload -> the worker's sandbox reads it -> confirm_dataset_mapping -> attach_upload_to_version), so every
-- upload rule, cap and the trust label ("Unverified, user-supplied": an upload is always unverified) is reused unchanged. After the upload the app calls mark_prepared_accepted(staged id, dataset id), which records WHO prepared it
-- and what the AI declared on the dataset (datasets.prepared_from, datasets.prep_log) and deletes the staged text.
-- WHAT IT ADDS. (1) the scope 'submit_data' on the consent page (connections made before keep their grant and do not get it); (2) two columns on public.datasets (prepared_from, prep_log); (3) the table public.prepared_data;
-- (4) connector functions (token hash only, EXECUTE only to connect_runner): connect_submit_prepared_data (scope submit_data) and connect_list_my_data (scope read: the person's uploaded datasets, by the story name u_<24 hex>);
-- (5) app functions (signed-in session only; the gate refuses a waiting-list account): my_prepared_data(), my_prepared_data_csv(uuid), discard_prepared_data(uuid), mark_prepared_accepted(uuid, uuid);
-- (6) ryagram_private.prepared_purge(): deletes staged items 7 days after they arrived (and accepted or discarded ones a day later). NOTHING CALLS IT YET: until the daily connector purge (connect_purge) calls it, an expired item is simply
-- invisible and refused (every read and write checks expires_at), and the purge is one line to add. Limits: at most 5 waiting and 10 a day per person (the AI is told in words, code PT429); the table is at most 200 KB and 5000 rows.
-- WHAT IT DOES NOT DO. It changes no grant on an existing object, no existing function, and nothing about how a story names a dataset (that is the connector's TypeScript: set_story learns that u_<hex> names the person's own approved uploads).
-- Needs 20261004000200_uploads_schema.sql (datasets, create_upload ...), 20261018000100_connect_ai.sql (connect_actor and the scopes), 20261027000400_live_editor.sql (ryagram_private.edit_text_ok) and the waiting-list gate (gate_apply).
-- UNRUN against a database: written and read, not executed. Undo: supabase/rollbacks/20261120000500_prepared_data_rollback.sql. After-check: supabase/live-steps/34_prepared_data_after_check.sql.

begin;

-- ---------------------------------------------------------------- what a dataset records about how it was prepared
alter table public.datasets
  add column prepared_from uuid,
  add column prep_log jsonb check (prep_log is null or (jsonb_typeof(prep_log) = 'object' and pg_column_size(prep_log) <= 16384));

-- ---------------------------------------------------------------- the staging table: inert text, closed to every API role
create table public.prepared_data (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  csv_text text not null check (octet_length(csv_text) <= 204800),
  sources jsonb not null check (jsonb_typeof(sources) = 'object' and octet_length(sources::text) <= 8192),
  change_log jsonb not null check (jsonb_typeof(change_log) = 'array' and jsonb_array_length(change_log) <= 12 and octet_length(change_log::text) <= 4096),
  measured jsonb not null check (jsonb_typeof(measured) = 'object' and octet_length(measured::text) <= 8192),
  ai_name text check (ai_name is null or char_length(ai_name) <= 60),
  state text not null default 'waiting' check (state in ('waiting', 'accepted', 'discarded')),
  dataset_id uuid references public.datasets (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  decided_at timestamptz
);
create index prepared_data_owner_idx on public.prepared_data (owner_id, created_at desc);
alter table public.prepared_data enable row level security;
revoke all on public.prepared_data from public, anon, authenticated, service_role, connect_runner;      -- read and written only through the definer functions below

-- ---------------------------------------------------------------- what the AI may send, checked here (the connector checks and measures first; this is the second lock)
create function ryagram_private.prepared_sources_ok(s jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare u jsonb; k text;
begin
  if s is null or jsonb_typeof(s) <> 'object' then return 'The sources must be an object.'; end if;
  if exists (select 1 from jsonb_object_keys(s) x where x not in ('urls', 'publisher', 'licence', 'units', 'notes', 'retrieved')) then return 'The sources have a field Ryagram does not know.'; end if;
  if jsonb_typeof(s -> 'urls') is distinct from 'array' or jsonb_array_length(s -> 'urls') not between 1 and 5 then return 'Give 1 to 5 source addresses (https).'; end if;
  for u in select * from jsonb_array_elements(s -> 'urls') loop
    if jsonb_typeof(u) <> 'string' or length(u #>> '{}') > 500
       or (u #>> '{}') !~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(/[\x21-\x7e]*)?$' then
      return 'Each source address must be an https:// website name with no user name, no port and no spaces.';
    end if;
  end loop;
  for k in select unnest(array['publisher', 'licence', 'units', 'notes', 'retrieved']) loop
    if s ? k then
      if jsonb_typeof(s -> k) <> 'string' or not ryagram_private.edit_text_ok(s ->> k, 300) then
        return format('"%s" must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).', k);
      end if;
    end if;
  end loop;
  if not (s ? 'licence') or not (s ? 'units') then return 'Say what the licence is and what the units are.'; end if;
  return null;
end $$;

create function ryagram_private.prepared_log_ok(l jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb;
begin
  if l is null or jsonb_typeof(l) <> 'array' or jsonb_array_length(l) > 12 then return false; end if;
  for e in select * from jsonb_array_elements(l) loop
    if jsonb_typeof(e) <> 'string' or not ryagram_private.edit_text_ok(e #>> '{}', 200) then return false; end if;
  end loop;
  return true;
end $$;

create function ryagram_private.prepared_measured_ok(m jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if m is null or jsonb_typeof(m) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(m) x where x not in ('rows', 'columns', 'header', 'places', 'first_period', 'last_period', 'periods_found', 'periods_missing', 'value_column', 'period_column', 'place_column')) then return false; end if;
  if coalesce(jsonb_typeof(m -> 'rows'), '') <> 'number' or coalesce(jsonb_typeof(m -> 'columns'), '') <> 'number' then return false; end if;
  if (m ->> 'rows')::numeric not between 1 and 5000 or (m ->> 'columns')::numeric not between 2 and 40 then return false; end if;
  return true;
end $$;
revoke execute on function ryagram_private.prepared_sources_ok(jsonb), ryagram_private.prepared_log_ok(jsonb), ryagram_private.prepared_measured_ok(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the AI hands over a table (the connector measures it first and passes what it measured)
create function public.connect_submit_prepared_data(p_token_hash text, p_label text, p_csv text, p_sources jsonb, p_change_log jsonb, p_measured jsonb, p_ai_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'submit_data');
  problem text; waiting int; today int; nid uuid; exp timestamptz;
begin
  if p_label is null or not ryagram_private.edit_text_ok(p_label, 120) then
    raise exception 'The label must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).' using errcode = '22023';
  end if;
  if p_csv is null or octet_length(p_csv) < 8 or octet_length(p_csv) > 204800 then
    raise exception 'The table must be CSV text of 200 KB or less. For a bigger table, give the person the cleaned file to upload by hand.' using errcode = '22023';
  end if;
  if p_csv ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'The table has control characters in it. Send plain CSV text.' using errcode = '22023';
  end if;
  problem := ryagram_private.prepared_sources_ok(p_sources);
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  if not ryagram_private.prepared_log_ok(coalesce(p_change_log, '[]'::jsonb)) then
    raise exception 'The change log is at most 12 steps, each 1 to 200 characters of plain words.' using errcode = '22023';
  end if;
  if not ryagram_private.prepared_measured_ok(p_measured) then
    raise exception 'The measured counts are not in the shape Ryagram expects.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prepared:' || me::text, 0));
  select count(*) into waiting from public.prepared_data where owner_id = me and state = 'waiting' and expires_at > now();
  if waiting >= 5 then
    raise exception 'There are already 5 tables waiting for the person to accept. Ask them to deal with those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.prepared_data where owner_id = me and created_at > now() - interval '24 hours';
  if today >= 10 then
    raise exception 'That is 10 prepared tables in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.prepared_data (owner_id, label, csv_text, sources, change_log, measured, ai_name)
    values (me, p_label, p_csv, p_sources, coalesce(p_change_log, '[]'::jsonb), p_measured, left(nullif(p_ai_name, ''), 60)) returning id, expires_at into nid, exp;
  return jsonb_build_object('prepared_id', nid, 'state', 'waiting', 'expires_at', exp, 'where', 'Your data');
end $$;

-- ---------------------------------------------------------------- what the AI may read about the person's own uploaded data (names, never rows)
create function public.connect_list_my_data(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return jsonb_build_object(
    'datasets', coalesce((select jsonb_agg(jsonb_build_object(
        'name', 'u_' || substr(replace(d.id::text, '-', ''), 1, 24), 'label', d.filename_label, 'status', d.status::text, 'geography', d.geography,
        'cadence', d.mapping ->> 'cadence', 'trust_label', 'unverified_user', 'prepared_by_ai', d.prepared_from is not null) order by d.created_at desc)
      from public.datasets d where d.owner_id = me and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null), '[]'::jsonb),
    'waiting_for_you', (select count(*) from public.prepared_data p where p.owner_id = me and p.state = 'waiting' and p.expires_at > now()));
end $$;

-- ---------------------------------------------------------------- the PERSON's side (a signed-in session; the gate refuses a waiting-list account)
create function public.my_prepared_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'label', p.label, 'sources', p.sources, 'change_log', p.change_log, 'measured', p.measured, 'ai_name', p.ai_name,
      'preview_lines', to_jsonb((regexp_split_to_array(p.csv_text, E'\r?\n'))[1:21]), 'created_at', p.created_at, 'expires_at', p.expires_at,
      'trust_label', 'unverified_user') order by p.created_at desc)
    from public.prepared_data p where p.owner_id = me and p.state = 'waiting' and p.expires_at > now()), '[]'::jsonb);
end $$;

create function public.my_prepared_data_csv(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); t text;
begin
  select p.csv_text into t from public.prepared_data p where p.id = p_id and p.owner_id = me and p.state = 'waiting' and p.expires_at > now();
  if not found then raise exception 'That table is not waiting for you any more.' using errcode = '22023'; end if;
  return t;
end $$;

create function public.discard_prepared_data(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); n int;
begin
  delete from public.prepared_data where id = p_id and owner_id = me and state = 'waiting';
  get diagnostics n = row_count;
  return jsonb_build_object('discarded', n > 0);
end $$;

-- after the browser has uploaded the table as a dataset of its own: record who prepared it and what was declared, and drop the staged text
create function public.mark_prepared_accepted(p_id uuid, p_dataset uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); p public.prepared_data; d public.datasets;
begin
  select * into p from public.prepared_data where id = p_id and owner_id = me and state = 'waiting' and expires_at > now() for update;
  if not found then raise exception 'That table is not waiting for you any more.' using errcode = '22023'; end if;
  select * into d from public.datasets where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
  if not found or d.prepared_from is not null or d.created_at < now() - interval '2 hours' then
    raise exception 'That upload is not one you just made from this table.' using errcode = '22023';
  end if;
  update public.datasets set prepared_from = p.id,
    prep_log = jsonb_build_object('declared_by', coalesce(p.ai_name, 'your AI'), 'declared_at', p.created_at, 'change_log', p.change_log, 'sources', p.sources, 'measured', p.measured, 'staged_id', p.id)
    where id = d.id;
  update public.prepared_data set state = 'accepted', dataset_id = d.id, csv_text = '', decided_at = now() where id = p.id;
  return jsonb_build_object('accepted', true, 'dataset_id', d.id);
end $$;

-- ---------------------------------------------------------------- retention: staged items go 7 days after they arrived (accepted or discarded ones a day after); NOTHING CALLS THIS YET (see the header)
create function ryagram_private.prepared_purge() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.prepared_data where expires_at < now() or (state <> 'waiting' and decided_at < now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function ryagram_private.prepared_purge() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- grants: the connector's two functions to the connector login only; the app's four to a signed-in session only
revoke execute on function public.connect_submit_prepared_data(text, text, text, jsonb, jsonb, jsonb, text), public.connect_list_my_data(text) from public, anon, authenticated;
grant execute on function public.connect_submit_prepared_data(text, text, text, jsonb, jsonb, jsonb, text), public.connect_list_my_data(text) to connect_runner;
revoke execute on function public.my_prepared_data(), public.my_prepared_data_csv(uuid), public.discard_prepared_data(uuid), public.mark_prepared_accepted(uuid, uuid) from public, anon;
grant execute on function public.my_prepared_data(), public.my_prepared_data_csv(uuid), public.discard_prepared_data(uuid), public.mark_prepared_accepted(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the new scope, offered on the consent page (connections made before keep their grant and do not get it)
create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data']::text[] $$;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused by the four app functions like everywhere else (the connector's two are for the connector login only, so the gate leaves them as they are)

commit;

-- PAPER, NOT A MIGRATION (NEXT-CONNECT 119). For CC1's review, then Ryan's go. Nothing here has been applied anywhere and nothing in the repo runs it except
-- tools/e2e-ride/delivery_sql_check.py, which applies it to a THROWAWAY Postgres built from the real migrations.
--
-- WHAT IT IS: a private, 30-day delivery link for a compilation film that was BUILT ON THE PERSON'S OWN COMPUTER. The film stays on that computer unless the person presses
-- "Get a private link" in their Ryagram app; only then is the one finished file uploaded. Same rules as a data film's delivery: private, kept `ops_settings.delivery_days` (30), a signed
-- link that lasts one hour and is made fresh on request, only the owner can ask for it, gone after the days are up or when the person deletes it.
--
-- WHY A NEW TABLE and not render_deliveries: render_deliveries needs an order and an artifact (a job on a story) and carries the label 'AI-assisted'; a compilation made from the person's own
-- clips has no story, no job and no AI-made picture, so it gets its own label ('Made on your computer'). It is also tester-only (account_settings.local_compute) and size-capped, because the
-- project is on the Free plan (1 GB of storage). The numbers below (150 MB a film, 600 MB a person, one upload at a time, 5 starts an hour) are DRAFT numbers for Ryan to change.
--
-- The app talks to the `node` edge function exactly as for a data film (device-code token, hash only): NO function takes an owner id. The edge function signs the one upload URL for the path the
-- DATABASE chose, exactly as /node/artifact does.
-- To land: copy into a new migration AFTER 20261021000100_r9_render_node.sql (it uses node_actor, node_user_hit, ops_settings.delivery_days) and its rollback; add the matching grants for
-- node_runner; extend ryagram_private.render_orders_tick() with compilation_tick() (see the end); extend get-delivery-url to try compilation_object_for second.

begin;

create table public.compilation_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  storage_path text not null unique,
  bytes bigint not null check (bytes between 1 and 157286400),                       -- 150 MB a film (DRAFT)
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_s numeric check (duration_s >= 0),
  width int check (width > 0),
  height int check (height > 0),
  label text not null default 'Made on your computer' check (label = 'Made on your computer'),
  visibility text not null default 'private' check (visibility = 'private'),
  state text not null default 'uploading' check (state in ('uploading', 'ready', 'failed')),
  expires_at timestamptz,                                                             -- set when the upload is verified
  deleted_at timestamptz,
  purged_at timestamptz,                                                              -- the object was handed to the purge
  created_at timestamptz not null default now(),
  check (state <> 'ready' or expires_at is not null)
);
create index compilation_deliveries_owner_idx on public.compilation_deliveries (owner_id) where deleted_at is null;
create index compilation_deliveries_expiry_idx on public.compilation_deliveries (expires_at) where deleted_at is null and state = 'ready';

alter table public.compilation_deliveries enable row level security;
revoke all on public.compilation_deliveries from public, anon, authenticated, service_role, node_runner;
grant select (id, title, bytes, duration_s, width, height, label, visibility, state, expires_at, created_at) on public.compilation_deliveries to authenticated;
create policy "Owners read their compilations" on public.compilation_deliveries for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);

-- POST /node/compilation/start (runner side, bearer token): the person pressed "Get a private link". Returns the id and the path the database chose; the edge function signs the upload.
create function public.node_compilation_begin(p_access_hash text, p_title text, p_bytes bigint, p_sha256 text,
                                              p_duration_s numeric default null, p_width int default null, p_height int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); new_id uuid := gen_random_uuid(); path text; used bigint;
begin
  if not coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) then
    raise exception 'Private links for films made on your computer are not switched on for this account yet.' using errcode = '42501';
  end if;
  perform ryagram_private.node_user_hit(me, 'compilation_start', 5, 3600);
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Give the film a title of 1 to 200 letters.' using errcode = '22023'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 157286400 then
    raise exception 'A film can be at most 150 MB to get a private link. Make it shorter or smaller.' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'That file fingerprint is not valid.' using errcode = '22023'; end if;
  update public.compilation_deliveries set state = 'failed'                          -- an upload nobody finished within the hour is over
    where owner_id = me and state = 'uploading' and created_at < now() - interval '1 hour';
  if exists (select 1 from public.compilation_deliveries where owner_id = me and state = 'uploading' and deleted_at is null) then
    raise exception 'One upload is already in progress. Wait for it to finish.' using errcode = '42501'; end if;
  select coalesce(sum(bytes), 0) into used from public.compilation_deliveries where owner_id = me and state = 'ready' and deleted_at is null;
  if used + p_bytes > 629145600 then
    raise exception 'Your private links hold 600 MB. Delete one you no longer need, then try again.' using errcode = '42501'; end if;
  path := me::text || '/compilations/' || new_id::text || '.mp4';
  insert into public.compilation_deliveries (id, owner_id, title, storage_path, bytes, sha256, duration_s, width, height)
    values (new_id, me, btrim(p_title), path, p_bytes, p_sha256, p_duration_s, p_width, p_height);
  return jsonb_build_object('id', new_id, 'path', path);
end $$;

-- POST /node/compilation/finish: the upload is done. The stored size must be the size the computer said (storage keeps the size, not the hash).
create function public.node_compilation_finish(p_access_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); d public.compilation_deliveries; stored bigint; days int; exp timestamptz;
begin
  select * into d from public.compilation_deliveries where id = p_id and owner_id = me and deleted_at is null for update;
  if not found then raise exception 'Upload not found.' using errcode = 'PT404'; end if;
  if d.state = 'ready' then return jsonb_build_object('id', d.id, 'expires_at', d.expires_at); end if;          -- finishing twice is harmless
  if d.state <> 'uploading' then raise exception 'This upload is over. Start again.' using errcode = '42501'; end if;
  select (o.metadata ->> 'size')::bigint into stored from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = d.storage_path;
  if stored is null or stored <> d.bytes then
    update public.compilation_deliveries set state = 'failed' where id = d.id;
    raise exception 'The stored file is not the size this computer said. Start again.' using errcode = '42501'; end if;
  select delivery_days into days from public.ops_settings where id;
  exp := now() + make_interval(days => days);
  update public.compilation_deliveries set state = 'ready', expires_at = exp where id = d.id;
  return jsonb_build_object('id', d.id, 'expires_at', exp);
end $$;

-- the person deletes it themselves (the website's list and the app): nothing remains to sign; the purge removes the object
create function public.delete_my_compilation(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  update public.compilation_deliveries set deleted_at = now() where id = p_id and owner_id = me and deleted_at is null;
  return found;
end $$;

-- the storage object behind a compilation link, for the get-delivery-url edge function only (service_role): it signs a 1-hour URL. Owner, state, expiry and deletion are enforced HERE.
create function ryagram_private.compilation_object(p_owner uuid, p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare d public.compilation_deliveries;
begin
  select * into d from public.compilation_deliveries where id = p_id and owner_id = p_owner;
  if not found then raise exception 'Delivery not found.' using errcode = 'PT404'; end if;
  if d.deleted_at is not null or d.state <> 'ready' or d.expires_at < now() then
    raise exception 'This film was kept for its days and has been deleted.' using errcode = '42501'; end if;
  return d.storage_path;
end $$;

create function public.compilation_object_for(p_owner uuid, p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return ryagram_private.compilation_object(p_owner, p_id);
end $$;

-- the purge, called from the existing render_orders_tick (add `|| ryagram_private.compilation_tick()` to its delete_objects): expired, deleted and failed rows lose their object
create function ryagram_private.compilation_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare paths jsonb := '[]'::jsonb; d record;
begin
  for d in select id, storage_path from public.compilation_deliveries
           where purged_at is null
             and ((state = 'ready' and expires_at < now()) or deleted_at is not null or (state = 'failed' and created_at < now() - interval '1 day'))
           for update skip locked loop
    update public.compilation_deliveries set deleted_at = coalesce(deleted_at, now()), purged_at = now() where id = d.id;
    paths := paths || to_jsonb(d.storage_path);
  end loop;
  return paths;
end $$;

revoke all on function public.node_compilation_begin(text, text, bigint, text, numeric, int, int), public.node_compilation_finish(text, uuid), public.delete_my_compilation(uuid),
  public.compilation_object_for(uuid, uuid), ryagram_private.compilation_object(uuid, uuid), ryagram_private.compilation_tick() from public, anon, authenticated, service_role, node_runner;
grant execute on function public.node_compilation_begin(text, text, bigint, text, numeric, int, int), public.node_compilation_finish(text, uuid) to node_runner;
grant execute on function public.delete_my_compilation(uuid) to authenticated;
grant execute on function public.compilation_object_for(uuid, uuid) to service_role;

commit;

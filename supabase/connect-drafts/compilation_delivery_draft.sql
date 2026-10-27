-- PAPER, NOT A MIGRATION (NEXT-CONNECT 119, redesigned by 120 for PAID SUBSCRIBERS, Ryan 14:14). For CC1's review, then Ryan's go. Nothing here has been applied anywhere and nothing in the repo runs it
-- except tools/e2e-ride/delivery_sql_check.py, which applies it to a THROWAWAY Postgres built from the real migrations (and the real Stripe test-mode file) and tries it as the real roles.
--
-- WHAT IT IS: a private, 30-day delivery link for a compilation film that was BUILT ON THE PERSON'S OWN COMPUTER. The film stays on that computer unless the person presses "Get a private link" in their
-- Ryagram desktop app; only then is the one finished file uploaded. Private, kept `ops_settings.delivery_days` (30), a signed link that lasts one hour and is made fresh on request, owner only, gone after
-- the days are up or when the person deletes it. The label is 'Made on your computer' (never the data films' 'AI-assisted').
--
-- WHO MAY USE IT: a person with an ACTIVE PLAN, nobody else. There is no tester flag (account_settings.local_compute is NOT consulted). The plan is read from public.stripe_subscriptions (filled by the Stripe
-- webhook): status 'active' or 'trialing', and not more than 3 days past current_period_end (the webhook may be late). What each plan may do is CONFIG, not code: public.plan_compilation_limits, one row per
-- plan code (sub_creator, sub_pro today): whether links are included, the largest film, the most kept at once, the uploads an hour. Ryan changes a row; no migration. A third switch,
-- ops_settings.compilation_links_on, is OFF until Ryan turns it on (his own statement in the SQL editor), whatever the plans say.
-- The app checks the same facts at launch with node_compilation_status() and keeps the answer for up to 7 days offline (the personal-engine pathway's launch check); the DATABASE re-checks them on every start and
-- every finish, so a lapsed plan cannot upload even with a stale cache. A lapsed plan does NOT take back films already kept: the owner keeps their link until the 30 days are up, and can always delete.
--
-- The app talks to the `node` edge function exactly as for a data film (device-code token, hash only): NO function takes an owner id. The edge function signs the one upload URL for the path the DATABASE chose.
-- To land: copy into a new migration AFTER 20261021000100_r9_render_node.sql (it uses node_actor, node_user_hit, ops_settings.delivery_days) and its rollback; extend ryagram_private.render_orders_tick()
-- with compilation_tick() (see the end); extend get-delivery-url to try compilation_object_for second. If stripe_subscriptions is not on the database yet (Phase 3 not applied) nobody has a plan and the
-- whole feature is simply locked: the plan reader checks for the table first.

begin;

alter table public.ops_settings add column compilation_links_on boolean not null default false;      -- OFF until Ryan says so

-- One row per plan code. DRAFT numbers for Ryan to change. The project is on the Supabase FREE plan today (1 GB of storage for everything, no backups): Pro brings 100 GB of storage and daily backups,
-- which is what makes the larger numbers safe. Until then keep the numbers small or leave the switch off.
create table public.plan_compilation_limits (
  price_code text primary key check (price_code ~ '^[a-z0-9_]{1,40}$'),                  -- matches credit_prices.code / stripe_subscriptions.price_code
  enabled boolean not null default false,                                                -- does this plan include private links at all
  max_film_bytes bigint not null check (max_film_bytes between 1 and 10737418240),
  max_kept_bytes bigint not null check (max_kept_bytes >= max_film_bytes),
  starts_per_hour int not null check (starts_per_hour between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into public.plan_compilation_limits (price_code, enabled, max_film_bytes, max_kept_bytes, starts_per_hour) values
  ('sub_creator', true, 157286400, 629145600, 5),               -- 150 MB a film, 600 MB kept
  ('sub_pro',     true, 524288000, 3221225472, 10);             -- 500 MB a film, 3 GB kept
alter table public.plan_compilation_limits enable row level security;
revoke all on public.plan_compilation_limits from public, anon, authenticated, service_role, node_runner;     -- read only by the definer functions below; edited by Ryan in the SQL editor

create table public.compilation_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  storage_path text not null unique,
  bytes bigint not null check (bytes between 1 and 10737418240),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_s numeric check (duration_s >= 0),
  width int check (width > 0),
  height int check (height > 0),
  label text not null default 'Made on your computer' check (label = 'Made on your computer'),
  visibility text not null default 'private' check (visibility = 'private'),
  state text not null default 'uploading' check (state in ('uploading', 'ready', 'failed')),
  rights_ticked boolean not null check (rights_ticked),                                  -- the person said they have the right to share what is in this film
  expires_at timestamptz,                                                                -- set when the upload is verified
  deleted_at timestamptz,
  purged_at timestamptz,                                                                 -- the object was handed to the purge
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

-- The person's ACTIVE plan code, or null. The only place that reads stripe_subscriptions for this feature.
create function ryagram_private.active_plan(p_owner uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare code text;
begin
  if to_regclass('public.stripe_subscriptions') is null then return null; end if;           -- Phase 3 not applied yet: nobody has a plan
  execute 'select price_code from public.stripe_subscriptions where owner_id = $1 and status in (''active'', ''trialing'')'
          || ' and (current_period_end is null or current_period_end > now() - interval ''3 days'') order by current_period_end desc nulls last limit 1'
    into code using p_owner;
  return code;
end $$;

-- The limits this person may use right now, or a plain refusal. Used by start and finish.
create function ryagram_private.compilation_limits(p_owner uuid) returns public.plan_compilation_limits
language plpgsql stable security definer set search_path = '' as $$
declare plan text; lim public.plan_compilation_limits;
begin
  if not (select o.compilation_links_on from public.ops_settings o where o.id) then
    raise exception 'Private links for films made on your computer are not switched on yet.' using errcode = '42501'; end if;
  plan := ryagram_private.active_plan(p_owner);
  if plan is null then
    raise exception 'Private links are part of a Ryagram plan. Choose a plan on the website, then try again.' using errcode = '42501'; end if;
  select * into lim from public.plan_compilation_limits where price_code = plan and enabled;
  if not found then
    raise exception 'Your plan does not include private links for films made on your computer.' using errcode = '42501'; end if;
  return lim;
end $$;

-- GET /node/compilation/status (runner side, bearer token): the app's launch check. Says what the plan allows; nothing is created. The app keeps this answer up to 7 days offline.
create function public.node_compilation_status(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); plan text; lim public.plan_compilation_limits; on_ boolean; used bigint;
begin
  select o.compilation_links_on into on_ from public.ops_settings o where o.id;
  plan := ryagram_private.active_plan(me);
  select * into lim from public.plan_compilation_limits where price_code = plan and enabled;
  select coalesce(sum(bytes), 0) into used from public.compilation_deliveries where owner_id = me and state = 'ready' and deleted_at is null;
  return jsonb_build_object('switch_on', on_, 'plan', plan, 'active', plan is not null,
    'allowed', coalesce(on_, false) and lim.price_code is not null,
    'max_film_bytes', lim.max_film_bytes, 'max_kept_bytes', lim.max_kept_bytes, 'starts_per_hour', lim.starts_per_hour, 'kept_bytes', used);
end $$;

-- POST /node/compilation/start (runner side, bearer token): the person pressed "Get a private link" and ticked the rights box. Returns the id and the path the database chose; the edge function signs the upload.
create function public.node_compilation_begin(p_access_hash text, p_title text, p_bytes bigint, p_sha256 text, p_rights boolean,
                                              p_duration_s numeric default null, p_width int default null, p_height int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); lim public.plan_compilation_limits; new_id uuid := gen_random_uuid(); path text; used bigint;
begin
  lim := ryagram_private.compilation_limits(me);
  perform ryagram_private.node_user_hit(me, 'compilation_start', lim.starts_per_hour, 3600);
  if p_rights is distinct from true then
    raise exception 'Tick that you have the right to share what is in this film.' using errcode = '22023'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Give the film a title of 1 to 200 letters.' using errcode = '22023'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > lim.max_film_bytes then
    raise exception 'A film can be at most % MB on your plan to get a private link. Make it shorter or smaller.', lim.max_film_bytes / 1048576 using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'That file fingerprint is not valid.' using errcode = '22023'; end if;
  update public.compilation_deliveries set state = 'failed'                          -- an upload nobody finished within the hour is over
    where owner_id = me and state = 'uploading' and created_at < now() - interval '1 hour';
  if exists (select 1 from public.compilation_deliveries where owner_id = me and state = 'uploading' and deleted_at is null) then
    raise exception 'One upload is already in progress. Wait for it to finish.' using errcode = '42501'; end if;
  select coalesce(sum(bytes), 0) into used from public.compilation_deliveries where owner_id = me and state = 'ready' and deleted_at is null;
  if used + p_bytes > lim.max_kept_bytes then
    raise exception 'Your plan keeps % MB of private links. Delete one you no longer need, then try again.', lim.max_kept_bytes / 1048576 using errcode = '42501'; end if;
  path := me::text || '/compilations/' || new_id::text || '.mp4';
  insert into public.compilation_deliveries (id, owner_id, title, storage_path, bytes, sha256, rights_ticked, duration_s, width, height)
    values (new_id, me, btrim(p_title), path, p_bytes, p_sha256, true, p_duration_s, p_width, p_height);
  return jsonb_build_object('id', new_id, 'path', path);
end $$;

-- POST /node/compilation/finish: the upload is done. The plan is checked AGAIN (a lapsed plan cannot finish); the stored size must equal the size the computer said (storage keeps the size, not the hash).
create function public.node_compilation_finish(p_access_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash); d public.compilation_deliveries; stored bigint; days int; exp timestamptz; lim public.plan_compilation_limits;
begin
  select * into d from public.compilation_deliveries where id = p_id and owner_id = me and deleted_at is null for update;
  if not found then raise exception 'Upload not found.' using errcode = 'PT404'; end if;
  if d.state = 'ready' then return jsonb_build_object('id', d.id, 'expires_at', d.expires_at); end if;          -- finishing twice is harmless
  if d.state <> 'uploading' then raise exception 'This upload is over. Start again.' using errcode = '42501'; end if;
  lim := ryagram_private.compilation_limits(me);
  select (o.metadata ->> 'size')::bigint into stored from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = d.storage_path;
  if stored is null or stored <> d.bytes then
    -- (a raise rolls this transaction back, so nothing can be marked here: the app calls node_compilation_cancel after a failed upload, and an upload nobody finishes is over after an hour)
    raise exception 'The stored file is not the size this computer said. Cancel and start again.' using errcode = '42501'; end if;
  select delivery_days into days from public.ops_settings where id;
  exp := now() + make_interval(days => days);
  update public.compilation_deliveries set state = 'ready', expires_at = exp where id = d.id;
  return jsonb_build_object('id', d.id, 'expires_at', exp);
end $$;

-- POST /node/compilation/cancel: the upload failed or the person changed their mind; the row is over and the purge removes any object
create function public.node_compilation_cancel(p_access_hash text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  update public.compilation_deliveries set state = 'failed' where id = p_id and owner_id = me and state = 'uploading';
  return found;
end $$;

-- the person deletes it themselves (the website's list and the app): nothing remains to sign; the purge removes the object. Always allowed, plan or not.
create function public.delete_my_compilation(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  update public.compilation_deliveries set deleted_at = now() where id = p_id and owner_id = me and deleted_at is null;
  return found;
end $$;

-- the storage object behind a compilation link, for the get-delivery-url edge function only (service_role): it signs a 1-hour URL. Owner, state, expiry and deletion are enforced HERE.
-- (Not the plan: a person keeps what they already made for its days, even after a plan lapses.)
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

-- the purge, called from the existing render_orders_tick (add `|| ryagram_private.compilation_tick()` to its delete_objects): expired, deleted and long-failed rows lose their object, once each
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

revoke all on function ryagram_private.active_plan(uuid), ryagram_private.compilation_limits(uuid), public.node_compilation_status(text),
  public.node_compilation_begin(text, text, bigint, text, boolean, numeric, int, int), public.node_compilation_finish(text, uuid), public.node_compilation_cancel(text, uuid),
  public.delete_my_compilation(uuid), public.compilation_object_for(uuid, uuid), ryagram_private.compilation_object(uuid, uuid), ryagram_private.compilation_tick()
  from public, anon, authenticated, service_role, node_runner;
grant execute on function public.node_compilation_status(text), public.node_compilation_begin(text, text, bigint, text, boolean, numeric, int, int),
  public.node_compilation_finish(text, uuid), public.node_compilation_cancel(text, uuid) to node_runner;
grant execute on function public.delete_my_compilation(uuid) to authenticated;
grant execute on function public.compilation_object_for(uuid, uuid) to service_role;

commit;

-- THE INVITE-ONLY APP DOWNLOAD (NEXT-CONNECT 133, re-aimed at Cloudflare R2 by Ryan's typed 'Q248: Cloudflare R2 for the invite-only download', CC1 2026-10-26 20:26). NOT APPLIED: a migration for CC1's review;
-- applying it is a live step Ryan takes. It makes no file public and signs nothing: SQL cannot sign a Cloudflare link, so the edge function app-download does that. This file decides WHO may be handed a link and
-- WHICH file, and keeps the record.
--
--   app_releases     the file Ryagram offers (name, exact size, SHA-256, the object's key in the private bucket, active). At most ONE release is active. Ryan adds a row from the SQL editor after uploading the zip
--                    (supabase/connect-live-style note in proposals\CONNECT-R2-SETUP.md); nothing here uploads anything.
--   app_downloads    one row per link handed out: who, when, which release, when the link ends. NO IP ADDRESS and nothing else about the person's computer.
--   request_app_download(owner)   service role only (the edge function checks the person's sign-in first and passes the owner, as delivery_object_for does). Refuses unless the account is an invited TESTER (the Windows
--                    card's own rule today) or an admin, and is not a worker login; at most 3 links in any 24 hours; the release must be active. Writes the row and returns ONLY: link id, file name, size, SHA-256,
--                    object key, lifetime in seconds (900).
--   my_app_downloads()            the signed-in person lists their own links (time and file name only: never the object key), for the account page.
-- Undo: supabase/rollbacks/20261026000500_app_downloads_rollback.sql.

begin;

create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (file_name ~ '^[A-Za-z0-9._-]{1,120}\.zip$'),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null check (object_key ~ '^[A-Za-z0-9._/-]{1,200}$' and object_key not like '%..%' and object_key not like '/%' and object_key not like '%//%'),
  active boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now());
create unique index app_releases_one_active on public.app_releases ((true)) where active;       -- at most one active release at a time

create table public.app_downloads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  release_id uuid not null references public.app_releases (id),
  asked_at timestamptz not null default now(),
  expires_at timestamptz not null);
create index app_downloads_owner_idx on public.app_downloads (owner_id, asked_at desc);

alter table public.app_releases enable row level security;
alter table public.app_downloads enable row level security;
revoke all on public.app_releases, public.app_downloads from public, anon, authenticated, service_role;

create function public.request_app_download(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.app_releases; d public.app_downloads;
begin
  if p_owner is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;
  if exists (select 1 from public.workers w where w.user_id = p_owner) then
    raise exception 'A worker account is not a person.' using errcode = 'PT403';
  end if;
  if not (coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_owner), false)
          or exists (select 1 from public.app_admins a where a.user_id = p_owner)) then
    raise exception 'The Ryagram app is for invited testers for now. Ask Ryan to turn it on for your account.' using errcode = 'PT403';
  end if;
  if (select count(*) from public.app_downloads x where x.owner_id = p_owner and x.asked_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have asked for the download three times in the last day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  select * into r from public.app_releases where active;
  if not found then
    raise exception 'The download is not ready yet.' using errcode = 'PT404';
  end if;
  insert into public.app_downloads (owner_id, release_id, expires_at) values (p_owner, r.id, now() + interval '15 minutes') returning * into d;
  return jsonb_build_object('link_id', d.id, 'file_name', r.file_name, 'size_bytes', r.size_bytes, 'sha256', r.sha256, 'object_key', r.object_key, 'expires_seconds', 900);
end $$;

create function public.my_app_downloads() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('asked_at', x.asked_at, 'file_name', r.file_name) order by x.asked_at desc), '[]'::jsonb)
    from (select * from public.app_downloads where owner_id = auth.uid() order by asked_at desc limit 20) x
    join public.app_releases r on r.id = x.release_id
$$;

revoke all on function public.request_app_download(uuid) from public, anon, authenticated;
grant execute on function public.request_app_download(uuid) to service_role;
revoke all on function public.my_app_downloads() from public, anon;
grant execute on function public.my_app_downloads() to authenticated;

commit;

-- The parts of a Supabase project the migrations depend on, for local testing
-- with plain Postgres. Not a migration; never run this against Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null, owner uuid, metadata jsonb,
  unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create publication supabase_realtime;

-- Ryan's project has "Automatically expose new tables" OFF: no default grants.
-- Model the strictest reading of that, so a migration that forgets a grant
-- fails here instead of in Supabase: no USAGE on public for the API roles, and
-- no EXECUTE for PUBLIC on new functions.
revoke usage on schema public from anon, authenticated;
revoke all on schema public from public;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

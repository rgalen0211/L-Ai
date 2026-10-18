-- OAuth premise proof: setup for the THROWAWAY project "ryagram-oauth-proof". Never run this on the live Ryagram project.
-- Paste the whole file into the SQL Editor and Run. It makes stand-ins for the real exposure:
--   proof_notes      a table with an owner-only policy (stands for every public table)
--   proof_spend()    a SECURITY DEFINER function granted to authenticated (stands for submit_job / admin_*)
--   connect_probe()  the one function an OAuth token IS allowed to call
--   proof bucket     a Storage bucket with an owner policy, plus the restrictive policy for OAuth tokens
-- The pre-request hook is NOT installed here; hook_on.sql / hook_off.sql switch it.

create table if not exists public.proof_notes (
  id bigserial primary key,
  owner_id uuid not null default auth.uid(),
  body text not null default ''
);
alter table public.proof_notes enable row level security;
drop policy if exists proof_notes_owner on public.proof_notes;
create policy proof_notes_owner on public.proof_notes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.proof_notes to authenticated;
grant usage, select on sequence public.proof_notes_id_seq to authenticated;

create or replace function public.proof_spend() returns text
language sql security definer set search_path = '' as $$ select 'spent for ' || auth.uid()::text $$;
revoke all on function public.proof_spend() from public, anon;
grant execute on function public.proof_spend() to authenticated;

-- Shows exactly which claims the database sees (names are what the proof reports; values stay here).
create or replace function public.claims_probe() returns jsonb
language sql stable as $$ select coalesce(auth.jwt(), '{}'::jsonb) $$;
grant execute on function public.claims_probe() to authenticated;

create or replace function public.connect_probe() returns text
language sql stable as $$ select 'connect ok; client_id=' || coalesce(auth.jwt() ->> 'client_id', '(none)') $$;
grant execute on function public.connect_probe() to authenticated;

insert into storage.buckets (id, name, public) values ('proof', 'proof', false) on conflict (id) do nothing;
drop policy if exists proof_files_owner on storage.objects;
create policy proof_files_owner on storage.objects for all to authenticated
  using (bucket_id = 'proof' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'proof' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- The chokepoint's storage half: any JWT that carries client_id is denied on storage.objects.
drop policy if exists proof_files_no_oauth on storage.objects;
create policy proof_files_no_oauth on storage.objects as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);

-- The chokepoint's database half: a PostgREST pre-request function.
create or replace function public.proof_pre_request() returns void
language plpgsql security definer set search_path = '' as $$
declare
  claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  path text := coalesce(current_setting('request.path', true), '');
begin
  if claims ->> 'client_id' is not null and path !~ '^/rpc/connect_[a-z_]+$' then
    raise exception 'This connection may only use the Ryagram connection functions.' using errcode = '42501';
  end if;
end $$;
grant execute on function public.proof_pre_request() to anon, authenticated;

-- Ryagram 2A follow-up: the worker account cannot act as a person.
--
-- Run after 20260928000200_2a_complete_is_final.sql (SQL Editor -> New query -> paste -> Run).
-- Found while writing the 2A-1 acceptance test: the worker signs in as a normal
-- Auth user, so its login could create projects and versions and submit jobs
-- of its own. A stolen worker password should only ever reach the worker's
-- functions. This closes that for projects and for create_version,
-- submit_job, cancel_job and queue_position, which all start with
-- ryagram_private.require_signed_in(). The worker functions are unchanged.

begin;

-- True when the caller is listed in public.workers (enabled or not).
create function ryagram_private.is_worker() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workers where user_id = auth.uid())
$$;
revoke execute on function ryagram_private.is_worker() from public, anon;
grant execute on function ryagram_private.is_worker() to authenticated;   -- the projects policy calls it

create or replace function ryagram_private.require_signed_in() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if ryagram_private.is_worker() then
    raise exception 'The worker account can only run jobs.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

drop policy "Owners create projects" on public.projects;
create policy "Owners create projects" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()) and not (select ryagram_private.is_worker()));

commit;

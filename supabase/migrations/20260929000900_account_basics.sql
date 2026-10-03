-- Account basics (queue item 7). NOT APPLIED.
--
-- 1. The store / don't-keep choice (spec 2B-6). Uploads don't exist in the app yet, so this is
--    the person's DEFAULT for future uploads (account_settings.upload_retention, "keep" unless
--    they change it), plus the rule that holds whenever a dataset is "dont_keep": every version
--    drawn from it is non-restorable at once and can never claim otherwise.
-- 2. Deleting an account. The delete-account Edge Function removes the person's files through
--    the Storage API and then the login, which cascades to every row they own. It asks here
--    first: nothing may be rendering, and an account with credit history is not hard-deleted
--    (the ledger is append-only and restricts deletion); its request is recorded for Ryan.
-- Password reset needs no SQL: it is Supabase Auth plus an email template (README).

begin;

-- ---------------------------------------------------------------- 1. data choice

create table public.account_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  upload_retention public.dataset_retention not null default 'keep',
  updated_at timestamptz not null default now()
);
alter table public.account_settings enable row level security;
revoke all on public.account_settings from anon, authenticated, service_role;
grant select, insert (upload_retention), update (upload_retention) on public.account_settings to authenticated;
create policy "Owners read their settings" on public.account_settings for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners add their settings" on public.account_settings for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners change their settings" on public.account_settings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create function ryagram_private.account_settings_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger account_settings_touch before update on public.account_settings
  for each row execute function ryagram_private.account_settings_touch();

-- "Don't keep my data": a version drawn from such a dataset is non-restorable, set immediately.
create function ryagram_private.versions_dont_keep() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.dataset_id is not null
     and exists (select 1 from public.datasets d where d.id = new.dataset_id and d.retention = 'dont_keep') then
    new.restorability := 'non_restorable';
  end if;
  return new;
end $$;
create trigger versions_dont_keep before insert or update of dataset_id, restorability on public.versions
  for each row execute function ryagram_private.versions_dont_keep();

-- And if a dataset becomes dont_keep later, the versions already using it follow. A dataset
-- that was not kept can't become kept again: its data is gone.
create function ryagram_private.datasets_retention() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.retention = 'dont_keep' and new.retention = 'keep' then
    raise exception 'This data was not kept, so it can''t be marked as kept now.' using errcode = '42501';
  end if;
  if new.retention = 'dont_keep' and old.retention is distinct from 'dont_keep' then
    update public.versions set restorability = 'non_restorable' where dataset_id = new.id;
  end if;
  return new;
end $$;
create trigger datasets_retention after update of retention on public.datasets
  for each row execute function ryagram_private.datasets_retention();

-- ---------------------------------------------------------------- 2. deleting an account

create table public.account_deletion_requests (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  reason text not null,
  requested_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated, service_role;
grant select (requested_at) on public.account_deletion_requests to authenticated;
create policy "Owners see their deletion request" on public.account_deletion_requests for select to authenticated
  using (owner_id = (select auth.uid()));

-- What delete-account needs to know before it touches anything.
create function public.account_deletion_check(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  history boolean := false;
begin
  if to_regclass('public.credit_ledger') is not null then          -- the 2B ledger may not be applied
    execute 'select exists (select 1 from public.credit_ledger where owner_id = $1)' into history using p_owner;
  end if;
  return jsonb_build_object(
    'active_jobs', (select count(*) from public.jobs where owner_id = p_owner
                      and state in ('queued', 'claimed', 'running', 'validating', 'uploading')),
    'has_credit_history', history,
    -- Every stored file under the person's folder, registered as an artifact or not (a
    -- partial upload has no artifact row). Paths are <owner id>/..., as register_artifact makes them.
    'storage_paths', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                                where o.bucket_id = 'ryagram-artifacts' and o.name like p_owner::text || '/%'), '[]'::jsonb));
end $$;

-- An account with credit history: recorded for Ryan, who closes it by hand.
create function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
end $$;

revoke execute on function ryagram_private.account_settings_touch(), ryagram_private.versions_dont_keep(),
  ryagram_private.datasets_retention() from public, anon, authenticated;
revoke execute on function public.account_deletion_check(uuid), public.account_request_deletion(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.account_deletion_check(uuid), public.account_request_deletion(uuid, text, text)
  to service_role;

commit;

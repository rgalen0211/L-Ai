-- Connect-an-AI per-account switch, on the admin page (NEXT-WEB 157, Claude 20:00 Tue 10-27). NOT APPLIED: Ryan applies it.
-- public.connect_access (20261018000100_connect_ai.sql) decides which accounts may connect an AI. Tonight Ryan had to run supabase/connect-live/03_invite_accounts.sql by hand to turn it
-- on for two testers, because no page changed it and nothing recorded who changed it or why. This adds what the tester-computers switch already has (20261021000100_r9_render_node.sql):
--   * admin_connect_access_set(email, on, reason): admin only and app sessions only (an AI's token is refused), a reason of 3 to 300 characters, refuses an administrator account and a
--     worker account, switching OFF also revokes that account's AI tokens, and every change is an audit row;
--   * admin_connect_access_audit(): the history, newest first (the table itself stays closed to every API role);
--   * admin_connect_access_list(): who has it on right now.
-- The older admin_set_connect_access(email, enabled) is left as it is.
-- Apply AFTER: 20261018000100_connect_ai.sql, 20261021000100_r9_render_node.sql (require_admin, workers).

create table public.connect_access_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  was_on boolean not null,
  turned_on boolean not null,
  set_by uuid not null references auth.users (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  at timestamptz not null default now());
alter table public.connect_access_audit enable row level security;
revoke all on public.connect_access_audit from public, anon, authenticated, service_role;

create function public.admin_connect_access_set(p_email text, p_on boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid; target uuid; old boolean; want boolean := coalesce(p_on, false);
begin
  perform ryagram_private.connect_app_session();
  me := ryagram_private.require_admin();
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'Say why, in a few words.' using errcode = '22023';
  end if;
  select id into target from auth.users where lower(email) = lower(btrim(p_email));
  if target is null then raise exception 'No account with that email.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.app_admins where user_id = target) then
    raise exception 'Administrator accounts cannot be connected to an AI assistant.' using errcode = '42501'; end if;
  if exists (select 1 from public.workers where user_id = target) then
    raise exception 'A worker account is not a person and cannot be connected to an AI assistant.' using errcode = '42501'; end if;
  old := coalesce((select a.enabled from public.connect_access a where a.user_id = target), false);
  insert into public.connect_access (user_id, enabled) values (target, want)
    on conflict (user_id) do update set enabled = excluded.enabled;
  if not want then
    update public.connect_tokens set revoked_at = now() where owner_id = target and revoked_at is null;
  end if;
  insert into public.connect_access_audit (user_id, was_on, turned_on, set_by, reason) values (target, old, want, me, btrim(p_reason));
  return want;
end $$;

create function public.admin_connect_access_audit() returns table (user_email text, was_on boolean, turned_on boolean, set_by_email text, reason text, at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select (select u.email from auth.users u where u.id = a.user_id)::text, a.was_on, a.turned_on,
                      (select u.email from auth.users u where u.id = a.set_by)::text, a.reason, a.at
               from public.connect_access_audit a order by a.at desc, a.id desc;
end $$;

create function public.admin_connect_access_list() returns table (user_email text, added_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select u.email::text, a.created_at from public.connect_access a join auth.users u on u.id = a.user_id where a.enabled order by lower(u.email);
end $$;

revoke execute on function public.admin_connect_access_set(text, boolean, text), public.admin_connect_access_audit(), public.admin_connect_access_list() from public, anon;
grant execute on function public.admin_connect_access_set(text, boolean, text), public.admin_connect_access_audit(), public.admin_connect_access_list() to authenticated;

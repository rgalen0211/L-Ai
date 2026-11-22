-- CONNECT-AN-AI OPENS TO EVERYONE WHO HAS SIGNED UP, AT LAUNCH (CONNECT 2026-11-21; Ryan's typed decision 11:30: "Connect-an-AI open to all signed-up users"; flipped only with him).
-- NOT APPLIED. Applying this file changes NOTHING a person can see: it adds one flag that is OFF, and a connect_person_ok that still answers exactly as before while the flag is off.
--
-- TODAY (20261018000100_connect_ai.sql): "invited" = an enabled row in public.connect_access, and never an administrator, and never a worker. connect_person_ok is the ONE rule behind the consent page, every connector call,
-- the departments list (department_person_ok) and the site's "may this account connect" check (connect_consent_check, which the site reads as invited), so opening it here opens all of them together.
--
-- WHAT THIS ADDS
--   (1) public.connect_flags.open_to_all, default false (the same one-row table as the master switch connections_enabled).
--   (2) ryagram_private.connect_open(): reads it (security definer, like connect_on(); closed to every API role).
--   (3) connect_person_ok, replaced: allowed when the account is enabled in connect_access, OR the flag is on AND the account has no DISABLED row there (an administrator's explicit block still wins while open);
--       an administrator and a worker are never allowed, open or not. With the flag off it is exactly the old rule.
--   (4) admin_connect_set_open(boolean): an administrator's own session flips it (mirror of admin_connect_set_enabled). The live steps also flip it from the SQL Editor (live-steps/36 and 37).
-- WHAT IT DOES NOT TOUCH: tokens, grants, scopes, rate limits, the consent page's own words (an administrator keeps the line "Administrator accounts cannot be connected to an AI assistant.").
-- THE EMERGENCY STOP is unchanged: admin_connect_revoke_all() ends every token and grant; admin_connect_set_enabled(false) refuses everything. Undo of this file: rollbacks/20261121000700_connect_ai_open_to_all_rollback.sql.
-- Needs: 20261018000100_connect_ai.sql. Tested: tests/connect-open-all.test.mjs (reads this file), supabase/tests/test_connect_open.py (a local Postgres; NOT RUN yet, see its header).

begin;

alter table public.connect_flags add column open_to_all boolean not null default false;

create function ryagram_private.connect_open() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select open_to_all from public.connect_flags where id), false) $$;

create or replace function ryagram_private.connect_person_ok(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_owner is not null
     and (exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)
          or (ryagram_private.connect_open() and not exists (select 1 from public.connect_access a where a.user_id = p_owner)))
     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
$$;

create function public.admin_connect_set_open(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform ryagram_private.connect_app_session();
  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update public.connect_flags set open_to_all = coalesce(p_on, false) where id;
end $$;

revoke all on function ryagram_private.connect_open() from public, anon, authenticated, connect_runner;
revoke all on function public.admin_connect_set_open(boolean) from public, anon, authenticated, connect_runner;
grant execute on function public.admin_connect_set_open(boolean) to authenticated;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused by the app functions like everywhere else (the new one is for an administrator's session)

commit;

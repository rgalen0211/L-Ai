-- THE CONNECTOR TELLS THE AI WHETHER THE ACCOUNT MAY HAVE THE DESKTOP APP (CONNECT, 2026-11-23; CC1's ruling 12:03: a stranger's AI must never be sent to a desktop app only invited testers can get).
-- NOT APPLIED: Ryan applies it, AFTER 20261018000100_connect_ai.sql and 20261026000500_app_downloads.sql. Rollback: supabase/rollbacks/20261123000500_connect_whoami_desktop_app_rollback.sql. Check: supabase/live-steps/61_connect_whoami_desktop_app_check.sql.
-- ONE FUNCTION CHANGES: public.connect_whoami (a copy of 20261018000100's with one added answer, 'desktop_app'). The same rule as request_app_download: true for an invited tester (account_settings.local_compute) or an administrator, never for a worker.
-- Grants and owner are kept (create or replace). The connector's compilation and download tools and the compilation question of suggest_next_step REFUSE for an account whose answer is false, saving nothing; an answer that is absent (this file not applied yet) is treated as allowed, so nothing changes until it is.
begin;
create or replace function public.connect_whoami(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); mail text; avail int := 0; held int := 0; desk boolean;
begin
  select email into mail from auth.users where id = me;
  if to_regclass('public.credit_balances') is not null then
    execute 'select coalesce(sum(available), 0)::int, coalesce(sum(held), 0)::int from public.credit_balances where owner_id = $1'
      into avail, held using me;
  end if;
  -- desktop_app: may this account have the Ryagram desktop app? EXACTLY request_app_download's rule (20261026000500): not a worker, and an invited tester (account_settings.local_compute) or an administrator.
  desk := not exists (select 1 from public.workers w where w.user_id = me)
          and (coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or exists (select 1 from public.app_admins a where a.user_id = me));
  return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held, 'desktop_app', desk);
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

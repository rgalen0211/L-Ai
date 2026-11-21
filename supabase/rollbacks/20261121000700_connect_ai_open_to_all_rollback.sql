-- CONNECT-AN-AI OPENS TO EVERYONE: the exact undo of migrations/20261121000700_connect_ai_open_to_all.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts ryagram_private.connect_person_ok back exactly as 20261018000100_connect_ai.sql defined it (an enabled connect_access row, never an administrator, never a worker), drops the admin function, the helper and the flag.
-- Nobody is disconnected by it: tokens and grants of accounts that were let in while it was open stay in the tables, but every call re-checks connect_person_ok, so an account that is not on the list is refused again from this moment;
-- run public.admin_connect_revoke_all() as well if those connections should end now. The flag's value is lost with the column.
begin;

create or replace function ryagram_private.connect_person_ok(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)
     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
$$;

drop function public.admin_connect_set_open(boolean);
drop function ryagram_private.connect_open();
alter table public.connect_flags drop column open_to_all;

commit;

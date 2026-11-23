-- THE EXACT UNDO of migrations/20261123000500_connect_whoami_desktop_app.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts public.connect_whoami back as 20261018000100_connect_ai.sql defined it (no 'desktop_app' answer: the connector then treats every account as allowed). Ends with gate_apply.
begin;
create or replace function public.connect_whoami(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); mail text; avail int := 0; held int := 0;
begin
  select email into mail from auth.users where id = me;
  if to_regclass('public.credit_balances') is not null then
    execute 'select coalesce(sum(available), 0)::int, coalesce(sum(held), 0)::int from public.credit_balances where owner_id = $1'
      into avail, held using me;
  end if;
  return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held);
end $$;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

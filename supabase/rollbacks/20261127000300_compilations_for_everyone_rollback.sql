-- THE EXACT UNDO of migrations/20261127000300_compilations_for_everyone.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- device_decide goes back to letting only a tester approve a computer (a computer already signed in by a compilations account keeps its token until it expires or is removed; revoke them first
-- if that matters: update public.node_tokens set revoked_at = now() where revoked_at is null and user_id not in (select owner_id from public.account_settings where local_compute)).
-- The run reports are dropped (copy them first if they matter: select * from public.compilation_runs). Requests the site saved STAY in compilation_requests (the connector's table).
-- Ends with gate_apply.
begin;

do $do$
declare def text; nw constant text := 'if p_approve and not (coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or ryagram_private.compilations_on(me)) then';
        o constant text := 'if p_approve and not coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) then';
begin
  def := replace(pg_get_functiondef('public.device_decide(text, boolean)'::regprocedure), chr(13), '');
  if position(nw in def) > 0 then
    execute replace(def, nw, o);
  end if;
end $do$;

drop function public.node_compilation_report(text, uuid, text, text, int, int, numeric, text);
drop function public.my_compilation_get(uuid);
drop function public.my_compilation_set(uuid, jsonb);
drop table public.compilation_runs;
drop function ryagram_private.compilation_request_problem(jsonb);
drop function ryagram_private.compilations_on(uuid);

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

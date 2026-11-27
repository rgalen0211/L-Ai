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
  if position('compilations_on' in replace(pg_get_functiondef('public.device_decide(text, boolean)'::regprocedure), chr(13), '')) > 0 then
    raise exception 'device_decide still names compilations_on: nothing was changed. Send this sentence to BUILDER.';
  end if;
end $do$;

do $do$
declare def text; nw constant text := '          or exists (select 1 from public.app_admins a where a.user_id = p_owner)' || chr(10) || '          or ryagram_private.compilations_on(p_owner)) then';
        o constant text := '          or exists (select 1 from public.app_admins a where a.user_id = p_owner)) then';
begin
  def := replace(pg_get_functiondef('public.request_app_download(uuid, text)'::regprocedure), chr(13), '');
  if position(nw in def) > 0 then
    execute replace(def, nw, o);
  end if;
  if position('compilations_on' in replace(pg_get_functiondef('public.request_app_download(uuid, text)'::regprocedure), chr(13), '')) > 0 then
    raise exception 'request_app_download still names compilations_on: nothing was changed. Send this sentence to BUILDER.';
  end if;
end $do$;

do $do$
declare def text; nw constant text := 'or exists (select 1 from public.app_admins a where a.user_id = me) or ryagram_private.compilations_on(me));';
        o constant text := 'or exists (select 1 from public.app_admins a where a.user_id = me));';
begin
  def := replace(pg_get_functiondef('public.connect_whoami(text)'::regprocedure), chr(13), '');
  if position(nw in def) > 0 then
    execute replace(def, nw, o);
  end if;
  if position('compilations_on' in replace(pg_get_functiondef('public.connect_whoami(text)'::regprocedure), chr(13), '')) > 0 then
    raise exception 'connect_whoami still names compilations_on: nothing was changed. Send this sentence to BUILDER.';
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

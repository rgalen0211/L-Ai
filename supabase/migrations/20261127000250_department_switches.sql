-- THE TOP BAR, PER ACCOUNT: A DEPARTMENT IS WORKING FOR AN ACCOUNT WHOSE SWITCH IS ON (BUILDER 2026-11-27; CC1's 08:10 one-switch design for Claude's 08:10 departments order).
-- NOT APPLIED: Ryan applies it (live step 82). Undo: supabase/rollbacks/20261127000250_department_switches_rollback.sql.
-- THE GAP: the top bar (my_departments) and the chat panel (connect_my_departments) both read ryagram_private.departments_for, which knows only the global departments.status and, for compilations,
--   the tester flag. A department switched on for ONE account in the per-account switch list (account_settings.switches_on, set only by admin_account_switch_set) still read 'Coming soon'.
-- THE FIX: ryagram_private.department_switch_on(person, department) maps each department to its switch name: compilations -> 'compilations', games -> 'games', geo_intelligence -> 'perfectCity'.
--   departments_for says 'working' when that switch is on for the account; otherwise exactly what it said before (the global status, and compilations' tester rule). Read from the LIVE text, one
--   clause replaced; refused in words if that clause is not there exactly once. Nothing else changes: no table, no column, no grant.
-- OPENING A DEPARTMENT FOR EVERYONE stays one row in public.departments (status 'working'; for compilations also needs_local_compute false): live steps 82a, 82b, 82c, each with its undo 82d, 82e, 82f.
-- Apply AFTER: 20261027000100_departments.sql, 20261110000400_account_switches.sql, 20261104000100_waiting_accounts.sql (this file ends with gate_apply()).
begin;

create or replace function ryagram_private.department_switch_on(p_owner uuid, p_department text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner is not null
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
     and coalesce((select (case p_department when 'compilations' then 'compilations' when 'games' then 'games' when 'geo_intelligence' then 'perfectCity' end) = any (s.switches_on)
                     from public.account_settings s where s.owner_id = p_owner), false)
$$;
revoke execute on function ryagram_private.department_switch_on(uuid, text) from public, anon, authenticated, service_role;

do $do$
declare def text; o constant text := 'case when d.status = ''working'' and d.needs_local_compute';
        nw constant text := 'case when ryagram_private.department_switch_on(p_owner, d.id) then ''working'' when d.status = ''working'' and d.needs_local_compute';
begin
  def := replace(pg_get_functiondef('ryagram_private.departments_for(uuid)'::regprocedure), chr(13), '');
  if position('department_switch_on' in def) > 0 then
    raise notice 'departments_for already reads the department switches, left alone.';
  elsif (length(def) - length(replace(def, o, ''))) / length(o) <> 1 then
    raise exception 'departments_for is not the one this change expects (its status rule differs from the repository); nothing was changed. Send this sentence to BUILDER.';
  else
    execute replace(def, o, nw);
  end if;
end $do$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

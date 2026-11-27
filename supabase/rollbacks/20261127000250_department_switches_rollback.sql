-- THE EXACT UNDO of migrations/20261127000250_department_switches.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- departments_for goes back to the global status and the tester rule only; the helper is dropped. Every account's switch list STAYS as it is (nothing here writes it). Ends with gate_apply.
-- If 20261127000300_compilations_for_everyone.sql is applied, undo THAT first (its compilations_on reads the helper this file drops; this file refuses in words otherwise).
begin;

do $do$
declare def text; nw constant text := 'case when ryagram_private.department_switch_on(p_owner, d.id) then ''working'' when d.status = ''working'' and d.needs_local_compute';
        o constant text := 'case when d.status = ''working'' and d.needs_local_compute';
begin
  if to_regprocedure('ryagram_private.compilations_on(uuid)') is not null then
    raise exception 'Undo 20261127000300_compilations_for_everyone first (its rollback), then this file. Nothing was changed.';
  end if;
  def := replace(pg_get_functiondef('ryagram_private.departments_for(uuid)'::regprocedure), chr(13), '');
  if position(nw in def) > 0 then
    execute replace(def, nw, o);
  end if;
end $do$;
drop function ryagram_private.department_switch_on(uuid, text);

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

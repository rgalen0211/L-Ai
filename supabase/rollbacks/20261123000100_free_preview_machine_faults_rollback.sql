-- FREE PREVIEW AND THE MACHINE'S FAULT: the exact undo of migrations/20261123000100_free_preview_machine_faults.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts ryagram_private.free_previews_used back as phase-2b/credits_ledger.sql defined it before 11-23: a failed preview is skipped only when its error class is 'infrastructure'. Previews already counted or not
-- are simply counted by the old rule again from the next call; nothing is stored. Does nothing (with a notice) when the ledger is not applied. Ends with gate_apply, like the migration.
-- NOTE: if phase-2b/credits_ledger.sql is applied from scratch later, it carries the NEW rule; this file only undoes the live function.
begin;

do $mig$
begin
  if to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is null then
    raise notice 'free_previews_used does not exist: the credits ledger is not applied, nothing to undo.';
    return;
  end if;
  execute $f$
    create or replace function ryagram_private.free_previews_used(p_owner uuid, p_project uuid, p_since timestamptz)
    returns int
    language sql stable set search_path = '' as $body$
      select count(*)::int from public.jobs
      where owner_id = p_owner and job_type = 'preview' and free_preview
        and (p_project is null or project_id = p_project)
        and (p_since is null or created_at >= p_since)
        and not (state = 'failed' and error_class = 'infrastructure')
    $body$
  $f$;
end $mig$;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

-- A STRANGER NEVER LOSES A FREE PREVIEW TO THE MACHINE'S FAULT (CONNECT, 2026-11-23; CC1's ruling 08:11 on WORKER's audit: a limit and an unsupported setup are the render machine's fault, not the person's).
-- NOT APPLIED: Ryan applies it, AFTER phase-2b/credits_ledger.sql (the ledger that owns the free previews). Rollback: supabase/rollbacks/20261123000100_free_preview_machine_faults_rollback.sql. Check: supabase/live-steps/51_free_preview_machine_faults_check.sql.
--
-- WHY: every person gets 6 free previews a project (15 in any 24 hours). ryagram_private.free_previews_used counts them and skips a failed preview only when its error CLASS is 'infrastructure'. The database sets the class from
-- the error CODE (error_class_for), and two codes the machine itself raises land in other classes: engine_unsupported (the worker's own setup: no limits for the job type, no ffmpeg, or, since WORKER's 11-23 change,
-- a catalog dataset or view missing from its list) is 'invalid_input', and limit_exceeded (memory or disk on the machine) is 'limit'. So a stranger who did nothing wrong lost a free preview, and for a person at the allowance
-- (6 used) the next one cost a credit.
-- WHAT THIS CHANGES: one extra condition in free_previews_used: a FAILED preview whose error_code is engine_unsupported or limit_exceeded is not counted, like an infrastructure failure. Everything else counts as before
-- (a story the engine refused, a timeout, a failed check, a cancelled or finished preview).
-- WHAT IT DOES NOT CHANGE: the error class of any code (so the worker's contract.py / tests/worker_contract.py stay as they are, and the page's words for a limit and for an unsupported setup stay as they are:
-- assets/app-jobs.js keys them on the code and the class), the price quote's shape, grants, or any table. The same body is in phase-2b/credits_ledger.sql, so an apply of the ledger from scratch is right too.
-- ORDER: if the ledger is not applied yet there is no free_previews_used to change: this file then does nothing (a notice says so) and the ledger file, which already carries the rule, is what to apply.

begin;

do $mig$
begin
  if to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is null then
    raise notice 'free_previews_used does not exist: the credits ledger (phase-2b/credits_ledger.sql) is not applied. That file carries this rule, so there is nothing to change here.';
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
        and not (state = 'failed' and (error_class = 'infrastructure' or error_code in ('engine_unsupported', 'limit_exceeded')))
    $body$
  $f$;
end $mig$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

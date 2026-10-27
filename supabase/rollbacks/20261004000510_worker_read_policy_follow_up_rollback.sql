-- THE EXACT UNDO of migrations/20261004000510_worker_read_policy_follow_up.sql (Q263 B2). NOT a migration: it lives outside migrations/ so nothing applies it by itself. Generated from the database state BEFORE that step
-- (every function below is that state's own definition, as Postgres prints it), and TESTED on a scratch Postgres: applying the step and then this file gives back the identical schema, grants included.
-- Goes back to the earlier worker read rule (the one that did not check a requested deletion, a confirmed upload, or the job owner).
begin;

CREATE OR REPLACE FUNCTION ryagram_private.worker_may_read_upload(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.datasets d join public.workers w on w.user_id = auth.uid() and w.enabled
    where d.storage_path = object_name and d.deleted_at is null
      and (exists (select 1 from public.dataset_ingests i
                   where i.dataset_id = d.id and i.state = 'claimed' and i.worker_user_id = w.user_id)
           or exists (select 1 from public.jobs j
                      where j.dataset_id = d.id and j.worker_user_id = w.user_id
                        and j.state in ('running', 'validating', 'uploading'))))
$function$;

commit;

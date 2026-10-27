-- THE EXACT UNDO of migrations/20261004000500_worker_job_upload.sql (Q263 B1). NOT a migration: it lives outside migrations/ so nothing applies it by itself. Generated from the database state BEFORE that step
-- (every function below is that state's own definition, as Postgres prints it), and TESTED on a scratch Postgres: applying the step and then this file gives back the identical schema, grants included.
-- Undo 20261027000200 and 20261004000510 FIRST if they have been applied (they redefine this function / the read rule). The live worker cannot read an upload after this (uploads are off).
begin;

drop function public.worker_job_upload(uuid);

commit;

-- LIVE, Q15c (CC1 2026-10-18 20:01): close the one REAL reach the connector's database login would have on a Supabase project.
-- WHY: on live the schema net (pg_net) grants USAGE to PUBLIC, i.e. to everyone, so the role connect_runner could call net.http_get, net.http_post and
-- net.http_delete (outbound HTTP from the database). The proof project never had pg_net, so the gate and the 04 report could not see it. USAGE that PUBLIC
-- holds cannot be taken from one role alone: the fix is a revoke from PUBLIC. It must be done BEFORE Q17 gives connect_runner a login.
-- WHAT OF OURS USES net: only the pg_cron jobs in supabase/README.md (ops-tick, ops-digest, cost-sync: select net.http_post(...)). A cron job runs as the role
-- that scheduled it, and that role holds its OWN USAGE on net (postgres, service_role, supabase_functions_admin ... have explicit grants), so the revoke
-- from PUBLIC leaves them working. Step 1 PROVES that read-only first; step 2 refuses to run unless it is true.
--
-- HOW TO USE (Ryan, in the LIVE SQL Editor, three separate runs; this file as pasted runs ONLY step 1, which only reads):
--   STEP 1  paste this whole file, Run. It reads. Success: the last row, kind 'verdict', says ok = true.
--   STEP 2  (only after step 1 says true) paste ONLY the text between '/* STEP 2' and the closing '*/' below, Run. It stops by itself if any cron job's
--           role would lose access. Undo: grant usage on schema net to public;
--   STEP 3  paste ONLY the text of STEP 3 below, Run; then run 01_after_migration_check.sql (expect 13/13 true) and watch ops-tick succeed a minute later.

-- ============================ STEP 1: READ-ONLY. Every column is named. ============================
select 'cron job' as kind, coalesce(j.jobname, 'job ' || j.jobid) as name, j.username || case when j.active then ' (active)' else ' (inactive)' end as detail,
       exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                where n.nspname = 'net' and a.grantee = (select r.oid from pg_roles r where r.rolname = j.username) and a.privilege_type = 'USAGE') as ok
  from cron.job j
union all
select 'usage on schema net', case when a.grantee = 0 then 'PUBLIC (everyone)' else a.grantee::regrole::text end, a.privilege_type, null::boolean
  from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'net'
union all
select 'verdict', 'every cron job runs as a role with its OWN usage on net (so revoking it from PUBLIC is safe)', null,
       not exists (select 1 from cron.job j
                    where not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                                       where n.nspname = 'net' and a.grantee = (select r.oid from pg_roles r where r.rolname = j.username) and a.privilege_type = 'USAGE'))
order by 1, 2;

/* STEP 2: THE LIVE FIX (a WRITE; one transaction-sized block; refuses by itself when it would break a cron job). Undo: grant usage on schema net to public;
do $$
begin
  if exists (select 1 from cron.job j
              where not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                                 where n.nspname = 'net' and a.grantee = (select r.oid from pg_roles r where r.rolname = j.username) and a.privilege_type = 'USAGE')) then
    raise exception 'STOP: a cron job runs as a role with no USAGE of its own on schema net; nothing was changed';
  end if;
  revoke usage on schema net from public;
end $$;
select case when a.grantee = 0 then 'PUBLIC (everyone)' else a.grantee::regrole::text end as still_has_usage_on_net, a.privilege_type as privilege
  from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'net' order by 1;
*/

/* STEP 3: READ-ONLY AFTERWARDS (then also run 01_after_migration_check.sql). A minute after step 2 the newest ops-tick run must be succeeded.
select d.jobid as job_id, d.status as run_status, d.return_message as run_message, d.start_time as started_at
  from cron.job_run_details d order by d.start_time desc limit 5;
select r.id as response_id, r.status_code as http_status, r.error_msg as error_message, r.created as created_at
  from net._http_response r order by r.created desc limit 5;
*/

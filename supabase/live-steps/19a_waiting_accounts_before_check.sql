-- BEFORE applying 20261104000100_waiting_accounts.sql: one SELECT, read-only. It lists what would make ryagram_private.gate_apply() STOP (and so roll the whole migration back, safely):
-- a function a signed-in person can run that takes arguments and is written in plain SQL, or is written in a language other than SQL and plpgsql. The answer must be NO ROWS.
select p.oid::regprocedure::text as function_that_would_stop_the_gate, l.lanname as language
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
 where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   and ((l.lanname = 'sql' and p.pronargs <> 0) or l.lanname not in ('sql', 'plpgsql'))
   and p.proname not like '%\_\_ungated'
 order by 1;

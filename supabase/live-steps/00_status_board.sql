-- STATUS BOARD for the morning live steps (NEXT-CONNECT 138): one SELECT, read-only, nothing is changed. Paste it into the SQL Editor of the live project at any time.
-- One row per database step: applied = true means that step's objects are already there. Run it first thing (every row should be false except what you already did), and again after each step.
select step, applied from (
  select 1 as n, 'Q239 B1  20261026000100 trust label on uploads' as step, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name = 'trust_label') as applied
  union all select 2, 'Q239 B2  20261026000200 the tick and the job claim', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'upload_trust')
  union all select 3, 'Q246 B   20261026000300 compilation requests', to_regclass('public.compilation_requests') is not null
  union all select 4, 'Q247 B   20261026000400 node reads compilation requests', to_regprocedure('public.node_compilation_requests(text)') is not null
  union all select 5, 'Q263 B1  20261004000500 worker_job_upload', to_regprocedure('public.worker_job_upload(uuid)') is not null
  union all select 6, 'Q263 B2  20261004000510 worker read policy follow-up', coalesce((select pg_get_functiondef(p.oid) like '%j.owner_id = d.owner_id%' from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'ryagram_private' and p.proname = 'worker_may_read_upload'), false)
  union all select 7, 'Q264 B   20261027000200 Recently deleted', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'datasets' and column_name = 'trashed_at')
  union all select 8, 'Q262 B   20261027000100 departments', to_regclass('public.departments') is not null
  union all select 9, 'Q265 B   20261027000300 find data (fetch)', to_regclass('public.fetch_hosts') is not null
) s order by n;

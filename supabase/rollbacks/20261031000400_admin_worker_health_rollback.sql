-- Undo 20261031000400_admin_worker_health.sql: the one function it adds. Nothing else changed, so nothing else is put back.
begin;
drop function if exists public.admin_worker_health();
commit;

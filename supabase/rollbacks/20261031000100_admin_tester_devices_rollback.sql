-- ADMIN: EACH TESTER'S COMPUTERS: the exact undo of migrations/20261031000100_admin_tester_devices.sql (NEXT-WEB 187). NOT a migration: nothing applies it by itself; Ryan runs it only to go back.
-- The function only reads; dropping it changes no data.
begin;
drop function if exists public.admin_tester_devices();
commit;

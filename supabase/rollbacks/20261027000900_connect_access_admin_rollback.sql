-- The exact undo of migrations/20261027000900_connect_access_admin.sql (Q301 B, the Connect-an-AI per-account switch on the admin page). NOT a migration: nothing applies it by itself.
-- WHAT IT LOSES: the history in connect_access_audit (who switched whom, when and why). The switch itself (public.connect_access) and the older admin_set_connect_access are not touched.
begin;
drop function if exists public.admin_connect_access_set(text, boolean, text);
drop function if exists public.admin_connect_access_audit();
drop function if exists public.admin_connect_access_list();
drop table if exists public.connect_access_audit;
commit;

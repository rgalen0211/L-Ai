-- THE PERSON'S DEPARTMENTS FOR THE AI'S HOME PANEL: the exact undo of migrations/20261113000200_connect_departments.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It removes the two functions and nothing else. The connector's home panel then says in words that the list is not available (the switch is off anyway).

begin;
drop function if exists public.connect_my_departments(text);
drop function if exists public.connect_my_switches(text);
commit;

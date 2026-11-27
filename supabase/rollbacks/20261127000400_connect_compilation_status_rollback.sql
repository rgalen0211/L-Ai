-- WHERE A COMPILATION STANDS, FOR THE PERSON'S AI: the exact undo of migrations/20261127000400_connect_compilation_status.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- (It has no gate_apply line: the migration's one function is the connector login's only, so the gate has nothing to change on the way out.)
-- It removes the one function and nothing else (the request table, BUILDER's run table and the site's own my_compilation_get are untouched). The connector's get_compilation_status then says that status is not available just now.

begin;
drop function if exists public.connect_compilation_get(text, uuid);
commit;

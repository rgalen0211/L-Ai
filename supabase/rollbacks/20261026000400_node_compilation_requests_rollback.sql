-- COMPILATION REQUESTS, THE APP'S SIDE: the exact undo of supabase/migrations/20261026000400_node_compilation_requests.sql (NEXT-CONNECT 131b). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It removes one read function; the saved requests (20261026000300) are untouched.
begin;
drop function if exists public.node_compilation_requests(text);
commit;

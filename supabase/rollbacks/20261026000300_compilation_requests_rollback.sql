-- COMPILATION REQUESTS ROLLBACK (NEXT-CONNECT 131a): the exact undo of supabase/migrations/20261026000300_compilation_requests.sql. NOT a migration: it lives outside migrations/ so nothing
-- applies it by itself. It LOSES every saved compilation request (they are small data rows the person's AI wrote; the person can ask for them again). Nothing else is touched.
begin;
drop function if exists public.connect_set_compilation_request(text, uuid, jsonb);
drop table if exists public.compilation_requests;
commit;

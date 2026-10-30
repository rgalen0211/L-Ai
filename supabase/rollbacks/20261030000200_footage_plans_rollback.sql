-- FOOTAGE PLANS: the exact undo of migrations/20261030000200_footage_plans.sql (NEXT-CONNECT 168, P1b). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every footage plan and its receipt (plans were requests, not data: no file was ever on the site) and removes the switch table. The scope 'fetch_data' and the download plans are not touched.
begin;

drop function if exists public.node_footage_update(text, uuid, text, jsonb);
drop function if exists public.node_footage_plans(text);
drop function if exists public.connect_list_footage(text);
drop function if exists public.connect_request_footage(text, text, text, text);
drop table if exists public.footage_plans;
drop function if exists ryagram_private.footage_on();
drop table if exists public.footage_flags;

commit;

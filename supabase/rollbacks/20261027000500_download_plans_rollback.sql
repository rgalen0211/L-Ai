-- DOWNLOAD PLANS: the exact undo of migrations/20261027000500_download_plans.sql (NEXT-CONNECT 152). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES every download plan and its receipt (the plans were requests, not data: no file was ever on the site) and puts the offered scopes back to what 20261027000400_live_editor.sql set
-- (read, write, render_free, edit). A connection that was granted 'fetch_data' keeps the word in its grant, but its tools are gone and the consent page no longer offers it.
begin;

drop function if exists public.node_download_update(text, uuid, text, jsonb);
drop function if exists public.node_download_plans(text);
drop function if exists public.connect_list_downloads(text);
drop function if exists public.connect_request_download(text, text, text, text);
drop table if exists public.download_plans;

create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit']::text[] $$;

commit;

-- THE INVITE-ONLY APP DOWNLOAD: the exact undo of supabase/migrations/20261026000500_app_downloads.sql (NEXT-CONNECT 133). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES the record of which links were handed out and the list of releases (the zip in the bucket is not touched; Ryan removes it in Cloudflare).
begin;
drop function if exists public.my_app_downloads();
drop function if exists public.request_app_download(uuid, text);
drop table if exists public.app_downloads;
drop table if exists public.app_releases;
commit;

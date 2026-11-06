-- EDITOR LINK CHECK: the exact undo of migrations/20261105000200_editor_link_check.sql (CONNECT, 2026-11-05). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It changes no data. Turn the editor-bundle function (or its EDITOR_LINK_KEY secret) off first: without this function every link read answers the plain 403.
begin;
drop function if exists public.connect_editor_link_owner(text, uuid);
drop function if exists public.editor_link_check(uuid, text);
drop function if exists ryagram_private.editor_link_owner_hash(uuid);
commit;

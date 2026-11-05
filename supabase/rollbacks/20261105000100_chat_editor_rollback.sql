-- CHAT EDITOR: the exact undo of migrations/20261105000100_chat_editor.sql (CONNECT, 2026-11-05). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It changes no data: drafts and ops written through these functions stay (they are ordinary rows of edit_drafts / edit_ops). Turn the connector's CONNECT_CHAT_EDITOR switch off first.
begin;
drop function if exists public.connect_editor_heartbeat(text, uuid, text);
drop function if exists public.connect_editor_since(text, uuid, text, bigint);
drop function if exists public.connect_editor_undo_ai(text, uuid, text);
drop function if exists public.connect_editor_undo(text, uuid, text, bigint);
drop function if exists public.connect_editor_apply(text, uuid, text, bigint, jsonb);
drop function if exists ryagram_private.chat_editor_gate(uuid, uuid, text);
drop function if exists ryagram_private.chat_editor_label();
commit;

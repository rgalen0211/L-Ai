-- THE LIVE PREVIEW EDITOR, AI HALF: the exact undo of migrations/20261027000400_live_editor.sql (NEXT-CONNECT 141). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It LOSES the shared drafts, the op log and the look-key list, and puts the offered scopes back to read / write / render_free. A connection that was granted 'edit' keeps the word in its grant, but the
-- tools are gone and the consent page no longer offers it. Nothing about a story, a job or a credit was ever touched by the migration, so nothing else is undone.
begin;

drop function if exists public.node_edit_post_summary(text, uuid, boolean, boolean, jsonb, jsonb);
drop function if exists public.node_edit_pending(text);
drop function if exists public.connect_edit_undo_ai(text, uuid, text);
drop function if exists public.connect_edit_ops(text, uuid, text, bigint, jsonb);
drop function if exists public.connect_edit_state(text, uuid);
drop function if exists public.editor_heartbeat(uuid, text);
drop function if exists public.my_edit_ops_since(uuid, text, bigint);
drop function if exists public.editor_undo_all_ai(uuid, text);
drop function if exists public.editor_undo(uuid, text, bigint);
drop function if exists public.editor_apply_ops(uuid, text, bigint, jsonb);
drop function if exists ryagram_private.edit_purge();
drop function if exists ryagram_private.undo_edit_ops(uuid, uuid, text, bigint[], text);
drop function if exists ryagram_private.apply_edit_ops(uuid, uuid, text, bigint, text, text, jsonb);
drop function if exists ryagram_private.edit_op_problem(text, jsonb);
drop function if exists ryagram_private.edit_text_ok(text, int);
drop table if exists public.edit_ops;
drop table if exists public.edit_drafts;
drop table if exists public.edit_look_keys;

create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free']::text[] $$;

commit;

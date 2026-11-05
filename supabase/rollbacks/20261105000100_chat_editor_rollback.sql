-- CHAT EDITOR: the exact undo of migrations/20261105000100_chat_editor.sql (CONNECT, 2026-11-05). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It changes no data: drafts and ops written through these functions stay (they are ordinary rows of edit_drafts / edit_ops). Turn the connector's CONNECT_CHAT_EDITOR switch off first.
begin;
-- put back the live editor's own definitions of the two functions this migration replaced (migrations/20261027000400_live_editor.sql)
create or replace function public.connect_edit_ops(p_token_hash text, p_project uuid, p_mode text, p_base_revision bigint, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
  label text;
begin
  select c.name into label from public.connect_tokens t join public.connect_clients c on c.client_id = t.client_id where t.access_hash = p_token_hash;
  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'ai', label, p_ops);
end $$;

create or replace function public.connect_edit_undo_ai(p_token_hash text, p_project uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
  ids bigint[];
begin
  if p_mode not in ('data', 'compilation') then raise exception 'That is not an editor mode.' using errcode = '22023'; end if;
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    raise exception 'That project was not found among your projects.' using errcode = 'PT404';
  end if;
  -- the AI's own most recent batch only (one revision), never the person's changes
  select coalesce(array_agg(e.id), '{}') into ids from public.edit_ops e
   where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.actor = 'ai' and e.status in ('applied', 'pending')
     and e.revision = (select max(x.revision) from public.edit_ops x where x.project_id = p_project and x.mode = p_mode and x.owner_id = me and x.actor = 'ai' and x.status in ('applied', 'pending'));
  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'ai');
end $$;
drop function if exists public.connect_editor_heartbeat(text, uuid, text);
drop function if exists public.connect_editor_since(text, uuid, text, bigint);
drop function if exists public.connect_editor_undo_ai(text, uuid, text);
drop function if exists public.connect_editor_undo(text, uuid, text, bigint);
drop function if exists public.connect_editor_apply(text, uuid, text, bigint, jsonb);
drop function if exists ryagram_private.chat_editor_gate(uuid, uuid, text);
drop function if exists ryagram_private.chat_editor_label();
commit;

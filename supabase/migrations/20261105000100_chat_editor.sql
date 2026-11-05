-- THE LIVE EDITOR INSIDE THE AI CHAT: the five calls its panel makes (CONNECT, 2026-11-05; plan proposals\CONNECT-MCP-APP-PLAN-1105.md section 3 and 5). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- Nothing happens until the connector's switches (CONNECT_MCP_APP and CONNECT_CHAT_EDITOR) are on, and they are OFF.
-- The website's editor calls editor_apply_ops / editor_undo / editor_undo_all_ai / my_edit_ops_since / editor_heartbeat as a SIGNED-IN person (a website session). The chat panel has no session and must not have one: it is
-- an iframe inside somebody else's page, and the host forwards its calls with the CONNECTOR token the person already gave their AI. So each call gets a twin here that takes the token's hash (like connect_edit_*), resolves the
-- person from it on every call (connect_actor, scope 'edit'), and then runs under the AI's rules. The server cannot tell a click in the panel from a client that holds the same token, so a panel call is never given the
-- person's powers:
--   * its changes are recorded as actor 'ai' under the AI's limits (20 a call, 60 a minute, 600 a day), with the fixed client label 'Ryagram panel' (the panel's page reads that label as the person's own, so it does not apply
--     its own edits twice); the person can undo them in the real editor;
--   * a compilation can be read or changed only when the person shared the track list with their AI (the same PT403 as the AI's own tools): without that a token could read tracks the person never shared;
--   * an undo touches ONLY ops whose actor is 'ai' (the AI's and the panel's), never the person's own edits made in the real editor;
--   * nothing here saves, builds, renders or spends: the draft becomes the film only when the person saves or builds it in the Ryagram app.
-- A heartbeat only says "an editor is open" (what get_edit_state reports as editor_open); it changes no draft.
-- Needs 20261027000400_live_editor.sql (apply_edit_ops, undo_edit_ops, edit_drafts, edit_ops) and 20261018000100_connect_ai.sql (connect_actor, connect_runner). Undo: supabase/rollbacks/20261105000100_chat_editor_rollback.sql.

begin;

-- the label the panel's own edits carry; fixed here, never taken from the caller
create function ryagram_private.chat_editor_label() returns text language sql immutable set search_path = '' as $$ select 'Ryagram panel'::text $$;

-- the one check every panel call runs after the person is known: a real mode, the person's own project, and (for a compilation) the track list shared with the AI
create function ryagram_private.chat_editor_gate(p_owner uuid, p_project uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_mode is null or p_mode not in ('data', 'compilation') then
    raise exception 'That is not an editor mode.' using errcode = '22023';
  end if;
  if p_project is null or not exists (select 1 from public.projects where id = p_project and owner_id = p_owner) then
    raise exception 'That project was not found among your projects.' using errcode = 'PT404';
  end if;
  if p_mode = 'compilation' and not coalesce((select d.ai_visible from public.edit_drafts d where d.project_id = p_project and d.mode = 'compilation' and d.owner_id = p_owner), false) then
    raise exception 'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.' using errcode = 'PT403';
  end if;
end $$;

create function public.connect_editor_apply(p_token_hash text, p_project uuid, p_mode text, p_base_revision bigint, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
begin
  perform ryagram_private.chat_editor_gate(me, p_project, p_mode);
  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'ai', ryagram_private.chat_editor_label(), p_ops);
end $$;

-- Undo one op, by id: only an op the AI side made (actor 'ai': the AI's or the panel's), and only the person's own project. Anything else is "nothing undone".
create function public.connect_editor_undo(p_token_hash text, p_project uuid, p_mode text, p_op_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit'); ids bigint[];
begin
  perform ryagram_private.chat_editor_gate(me, p_project, p_mode);
  select coalesce(array_agg(e.id), '{}') into ids from public.edit_ops e
   where e.id = p_op_id and e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.actor = 'ai';
  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'ai');
end $$;

-- Undo everything the AI side has done and not yet had undone (the button "Undo all"): ops with actor 'ai' only.
create function public.connect_editor_undo_ai(p_token_hash text, p_project uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit'); ids bigint[];
begin
  perform ryagram_private.chat_editor_gate(me, p_project, p_mode);
  select coalesce(array_agg(e.id), '{}') into ids from public.edit_ops e
   where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.actor = 'ai' and e.status in ('applied', 'pending');
  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'ai');
end $$;

-- The log since a revision, the same answer the website's editor gets, for the person's own project only. Scope 'edit', like the changes: a connection that may only read cannot open the panel.
create function public.connect_editor_since(p_token_hash text, p_project uuid, p_mode text, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit'); d public.edit_drafts;
begin
  perform ryagram_private.chat_editor_gate(me, p_project, p_mode);
  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode and owner_id = me;
  if not found then return jsonb_build_object('revision', 0, 'state', '{}'::jsonb, 'mirrored', false, 'ai_visible', false, 'ops', '[]'::jsonb); end if;
  return jsonb_build_object('revision', d.revision, 'state', d.state, 'mirrored', d.mirrored, 'ai_visible', d.ai_visible,
    'ops', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'revision', x.revision, 'actor', x.actor, 'client', x.client_label, 'op', x.op, 'status', x.status, 'at', x.created_at) order by x.id)
                       from (select * from public.edit_ops e where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.revision > greatest(coalesce(p_revision, 0), 0) order by e.id limit 200) x), '[]'::jsonb));
end $$;

-- "An editor is open": get_edit_state reports editor_open for 30 seconds after this. No draft changes, no revision.
create function public.connect_editor_heartbeat(p_token_hash text, p_project uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
begin
  perform ryagram_private.chat_editor_gate(me, p_project, p_mode);
  insert into public.edit_drafts (project_id, mode, owner_id, editor_seen_at) values (p_project, p_mode, me, now())
  on conflict (project_id, mode) do update set editor_seen_at = now() where public.edit_drafts.owner_id = me;
  return 'null'::jsonb;
end $$;

revoke execute on function ryagram_private.chat_editor_label(), ryagram_private.chat_editor_gate(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.connect_editor_apply(text, uuid, text, bigint, jsonb), public.connect_editor_undo(text, uuid, text, bigint), public.connect_editor_undo_ai(text, uuid, text),
  public.connect_editor_since(text, uuid, text, bigint), public.connect_editor_heartbeat(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.connect_editor_apply(text, uuid, text, bigint, jsonb), public.connect_editor_undo(text, uuid, text, bigint), public.connect_editor_undo_ai(text, uuid, text),
  public.connect_editor_since(text, uuid, text, bigint), public.connect_editor_heartbeat(text, uuid, text) to connect_runner;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

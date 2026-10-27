-- LIVE PREVIEW EDITOR, THE AI HALF (NEXT-CONNECT 141; Ryan 2026-10-27 09:00). NOT APPLIED: a proposal for CC1. Design: Ryagram-logs/proposals/CONNECT-LIVE-EDITOR-TOOLS.md.
-- It needs 20261018000100_connect_ai.sql (the connector) and 20261021000100_r9_render_node.sql (the signed-in computer) applied. Undo: supabase/rollbacks/20261027000400_live_editor_rollback.sql.
--
-- WHAT IT IS. ONE shared DRAFT per project and mode, with a revision number, and an append-only LOG of small closed-vocabulary OPS, each with its inverse. The person's open editor and the
-- person's own AI both change the draft through ONE function (ryagram_private.apply_edit_ops), so "the AI changes the same state the person sees" is true without the AI touching the browser.
-- The draft is NOT the film: only the person's Save (a data film) or Build (a compilation) commits, through the validation that exists today. Nothing here can start a job, spend a credit, publish,
-- fetch, delete, or accept a path: an op is one of a fixed list of shapes, checked in SQL.
--   mode 'data'         the draft is a set of LOOK overrides ({"look": {key: value}}) over the saved story; the AI's ops apply at once and are undoable.
--   mode 'compilation'  the real tracks live in the person's DESKTOP APP (videos never leave the computer). The app mirrors a TRACK SUMMARY here only if the person ticks "let my AI see my track list"
--                       (names and times, never paths, video, pictures or audio) for the person's own web editor (`mirrored`) and, if they tick, for their AI (`ai_visible`); edits from either wait here as PENDING,
--                       the app applies them locally and posts the new summary.
-- The look keys below are STAND-IN rows (a table of data, not code) until ENGINE 35 names the real ones; replacing them is one reviewed insert/delete.

begin;

-- ---------------------------------------------------------------- the look keys (data, not code)
create table public.edit_look_keys (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{0,59}$'),
  kind text not null check (kind in ('colour', 'enum', 'number', 'bool')),
  choices text[],
  min_value numeric,
  max_value numeric,
  stand_in boolean not null default true,
  check ((kind = 'enum') = (choices is not null and cardinality(choices) between 1 and 40)),
  check ((kind = 'number') = (min_value is not null and max_value is not null and min_value < max_value))
);
alter table public.edit_look_keys enable row level security;
revoke all on public.edit_look_keys from public, anon, authenticated, service_role;
insert into public.edit_look_keys (key, kind, choices, min_value, max_value) values
  ('theme', 'enum', array['light', 'dark'], null, null),
  ('palette.background', 'colour', null, null, null),
  ('palette.primary', 'colour', null, null, null),
  ('palette.secondary', 'colour', null, null, null),
  ('palette.accent', 'colour', null, null, null),
  ('marker.shape', 'enum', array['circle', 'square', 'diamond'], null, null),
  ('marker.border_width', 'number', null, 0, 8),
  ('marker.glow', 'bool', null, null, null),
  ('labels.show', 'bool', null, null, null);

-- ---------------------------------------------------------------- the shared draft and the log
create table public.edit_drafts (
  project_id uuid not null references public.projects (id) on delete cascade,
  mode text not null check (mode in ('data', 'compilation')),
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 262144),
  mirrored boolean not null default false,                -- compilation: the desktop app posts a track summary here for the person's own web editor
  ai_visible boolean not null default false,              -- compilation: the person ALSO ticked "let my AI see my track list" (implies mirrored)
  check (not ai_visible or mirrored),
  editor_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'person' check (char_length(updated_by) <= 60),
  primary key (project_id, mode)
);
alter table public.edit_drafts enable row level security;
revoke all on public.edit_drafts from public, anon, authenticated, service_role;      -- read and written only through the functions below

create table public.edit_ops (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  mode text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null,
  actor text not null check (actor in ('person', 'ai')),
  client_label text check (char_length(client_label) <= 60),
  op jsonb not null check (pg_column_size(op) <= 4096),
  inverse jsonb check (inverse is null or pg_column_size(inverse) <= 4096),
  status text not null default 'applied' check (status in ('applied', 'pending', 'undone', 'rejected')),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, mode) references public.edit_drafts (project_id, mode) on delete cascade
);
create index edit_ops_by_project on public.edit_ops (project_id, mode, id);
create index edit_ops_by_owner_time on public.edit_ops (owner_id, actor, created_at desc);
alter table public.edit_ops enable row level security;
revoke all on public.edit_ops from public, anon, authenticated, service_role;
grant select on public.edit_ops to authenticated;
create policy "Owners read their edit log" on public.edit_ops for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- the closed vocabulary
-- Text an op may carry: no control character, no bidirectional override, no place on a computer (a drive, a share, a parent folder, a path from the root, a web or file address).
create function ryagram_private.edit_text_ok(t text, max_len int) returns boolean
language sql immutable set search_path = '' as $$
  select t is not null and char_length(t) between 1 and max_len
     and t !~ '[[:cntrl:]]'
     and t !~ ('[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || chr(8206) || chr(8207) || ']')
     and t !~ '([A-Za-z]:[\\/]|\\\\|(^|\s)/[A-Za-z]|\.\.[\\/]|[A-Za-z][A-Za-z0-9+.-]*://)'
$$;

-- null = fine; otherwise the plain sentence. Nested ifs, not AND/OR chains: SQL does not promise to stop at the first false.
create function ryagram_private.edit_op_problem(p_mode text, p_op jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  kind text;
  k record;
  v jsonb;
  keys text[];
  allowed text[];
  pos text[] := array['top', 'centre', 'bottom', 'lower_third'];
begin
  if p_op is null or jsonb_typeof(p_op) <> 'object' then return 'A change must be an object.'; end if;
  if jsonb_typeof(p_op -> 'op') is distinct from 'string' then return 'A change needs an "op" naming what it does.'; end if;
  kind := p_op ->> 'op';
  keys := array(select jsonb_object_keys(p_op));
  if p_mode = 'data' then
    if kind = 'set_look' then allowed := array['op', 'key', 'value'];
    elsif kind = 'unset_look' then allowed := array['op', 'key'];
    else return format('"%s" is not a change this editor knows for a data film.', left(kind, 40)); end if;
    if exists (select 1 from unnest(keys) x where x <> all (allowed)) then return 'That change has a field the editor does not know.'; end if;
    if jsonb_typeof(p_op -> 'key') is distinct from 'string' then return 'A look change needs a "key".'; end if;
    select * into k from public.edit_look_keys where key = p_op ->> 'key';
    if not found then return format('"%s" is not a look setting the editor has.', left(p_op ->> 'key', 60)); end if;
    if kind = 'unset_look' then return null; end if;
    if not (p_op ? 'value') then return 'A set_look change needs a "value".'; end if;
    v := p_op -> 'value';
    if k.kind = 'colour' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' then return format('"%s" needs a colour like #1a73e8.', k.key); end if;
    elsif k.kind = 'enum' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') <> all (k.choices) and not ((v #>> '{}') = any (k.choices)) then return format('"%s" can only be: %s.', k.key, array_to_string(k.choices, ', ')); end if;
    elsif k.kind = 'number' then
      if jsonb_typeof(v) <> 'number' then return format('"%s" needs a number.', k.key); end if;
      if (v #>> '{}')::numeric < k.min_value or (v #>> '{}')::numeric > k.max_value then return format('"%s" must be between %s and %s.', k.key, k.min_value, k.max_value); end if;
    elsif k.kind = 'bool' then
      if jsonb_typeof(v) <> 'boolean' then return format('"%s" must be true or false.', k.key); end if;
    end if;
    return null;
  end if;
  -- mode 'compilation'
  if kind = 'move_clip' then allowed := array['op', 'clip_id', 'start_s'];
  elsif kind = 'trim_clip' then allowed := array['op', 'clip_id', 'in_s', 'out_s'];
  elsif kind = 'replace_clip' then allowed := array['op', 'clip_id', 'candidate_id'];
  elsif kind = 'remove_clip' then allowed := array['op', 'clip_id'];
  elsif kind = 'reorder' then allowed := array['op', 'clip_ids'];
  elsif kind = 'add_overlay' then allowed := array['op', 'kind', 'text', 'picture', 'start_s', 'length_s', 'position', 'size'];
  elsif kind = 'remove_overlay' then allowed := array['op', 'overlay_id'];
  elsif kind = 'set_music_level' then allowed := array['op', 'track_id', 'level'];
  else return format('"%s" is not a change this editor knows for a compilation.', left(kind, 40)); end if;
  if exists (select 1 from unnest(keys) x where x <> all (allowed)) then return 'That change has a field the editor does not know.'; end if;
  -- ids
  for k in select a as name from unnest(array['clip_id', 'candidate_id', 'overlay_id', 'track_id']) a loop
    if p_op ? k.name then
      if jsonb_typeof(p_op -> k.name) <> 'string' or (p_op ->> k.name) !~ '^[A-Za-z0-9_-]{1,40}$' then return format('"%s" must be an id from get_edit_state.', k.name); end if;
    end if;
  end loop;
  if kind in ('move_clip', 'trim_clip', 'replace_clip', 'remove_clip') and not (p_op ? 'clip_id') then return 'This change needs a "clip_id".'; end if;
  if kind = 'replace_clip' and not (p_op ? 'candidate_id') then return 'replace_clip needs a "candidate_id".'; end if;
  if kind = 'remove_overlay' and not (p_op ? 'overlay_id') then return 'remove_overlay needs an "overlay_id".'; end if;
  if kind = 'set_music_level' and not (p_op ? 'track_id') then return 'set_music_level needs a "track_id".'; end if;
  -- numbers
  for k in select a as name from unnest(array['start_s', 'in_s', 'out_s', 'length_s', 'level']) a loop
    if p_op ? k.name then
      if jsonb_typeof(p_op -> k.name) <> 'number' then return format('"%s" must be a number.', k.name); end if;
    end if;
  end loop;
  if kind = 'move_clip' then
    if not (p_op ? 'start_s') then return 'move_clip needs "start_s".'; end if;
    if (p_op ->> 'start_s')::numeric < 0 or (p_op ->> 'start_s')::numeric > 86400 then return '"start_s" must be between 0 and 86400 seconds.'; end if;
  elsif kind = 'trim_clip' then
    if not (p_op ? 'in_s') or not (p_op ? 'out_s') then return 'trim_clip needs "in_s" and "out_s".'; end if;
    if (p_op ->> 'in_s')::numeric < 0 or (p_op ->> 'out_s')::numeric > 86400 or (p_op ->> 'out_s')::numeric <= (p_op ->> 'in_s')::numeric then return 'Trim times must run forward, inside 0 to 86400 seconds.'; end if;
  elsif kind = 'reorder' then
    if jsonb_typeof(p_op -> 'clip_ids') is distinct from 'array' or jsonb_array_length(p_op -> 'clip_ids') not between 1 and 200 then return '"clip_ids" must list 1 to 200 clips.'; end if;
    if exists (select 1 from jsonb_array_elements(p_op -> 'clip_ids') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[A-Za-z0-9_-]{1,40}$') then return '"clip_ids" must be ids from get_edit_state.'; end if;
    if (select count(distinct e #>> '{}') from jsonb_array_elements(p_op -> 'clip_ids') e) <> jsonb_array_length(p_op -> 'clip_ids') then return '"clip_ids" must not repeat a clip.'; end if;
  elsif kind = 'set_music_level' then
    if not (p_op ? 'level') then return 'set_music_level needs a "level".'; end if;
    if (p_op ->> 'level')::numeric < 0 or (p_op ->> 'level')::numeric > 1 then return '"level" must be between 0 and 1.'; end if;
  elsif kind = 'add_overlay' then
    if jsonb_typeof(p_op -> 'kind') is distinct from 'string' or (p_op ->> 'kind') not in ('text', 'image') then return 'An overlay is a "text" or an "image".'; end if;
    if not (p_op ? 'start_s') or not (p_op ? 'length_s') or not (p_op ? 'position') then return 'An overlay needs "start_s", "length_s" and "position".'; end if;
    if (p_op ->> 'start_s')::numeric < 0 or (p_op ->> 'start_s')::numeric > 3600 then return '"start_s" must be between 0 and 3600 seconds.'; end if;
    if (p_op ->> 'length_s')::numeric < 0.5 or (p_op ->> 'length_s')::numeric > 30 then return '"length_s" must be between 0.5 and 30 seconds.'; end if;
    if jsonb_typeof(p_op -> 'position') <> 'string' or (p_op ->> 'position') <> all (pos) and not ((p_op ->> 'position') = any (pos)) then return '"position" must be top, centre, bottom or lower_third.'; end if;
    if p_op ? 'size' and (jsonb_typeof(p_op -> 'size') <> 'string' or (p_op ->> 'size') not in ('small', 'medium', 'large')) then return '"size" must be small, medium or large.'; end if;
    if p_op ->> 'kind' = 'text' then
      if p_op ? 'picture' or not (p_op ? 'text') then return 'A text overlay needs "text" and no "picture".'; end if;
      if jsonb_typeof(p_op -> 'text') <> 'string' or not ryagram_private.edit_text_ok(p_op ->> 'text', 120) then return 'The overlay text must be 1 to 120 characters of plain words (no places on a computer, no web addresses).'; end if;
    else
      if p_op ? 'text' or not (p_op ? 'picture') then return 'An image overlay needs a "picture" name and no "text".'; end if;
      if jsonb_typeof(p_op -> 'picture') <> 'string' or (p_op ->> 'picture') !~* '^[^\\/:*?"<>|[:cntrl:]]{1,100}\.(png|jpg|jpeg|webp)$' then return 'A picture is the NAME of one the person added in the app (png, jpg or webp), never a place.'; end if;
    end if;
  end if;
  return null;
end $$;
revoke execute on function ryagram_private.edit_text_ok(text, int), ryagram_private.edit_op_problem(text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the one place ops are applied
create function ryagram_private.apply_edit_ops(p_owner uuid, p_project uuid, p_mode text, p_base bigint, p_actor text, p_client text, p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.edit_drafts;
  o jsonb;
  prob text;
  n int;
  i int := 0;
  newrev bigint;
  st jsonb;
  look jsonb;
  kname text;
  prev jsonb;
  inv jsonb;
  client text := nullif(left(regexp_replace(btrim(coalesce(p_client, '')), '[[:cntrl:]]', ' ', 'g'), 60), '');
begin
  if p_mode not in ('data', 'compilation') or p_actor not in ('person', 'ai') then
    raise exception 'That is not an editor mode.' using errcode = '22023';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) not between 1 and 20 then
    raise exception 'Send between 1 and 20 changes at a time.' using errcode = '22023';
  end if;
  n := jsonb_array_length(p_ops);
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || p_mode, 2027));
  if not exists (select 1 from public.projects where id = p_project and owner_id = p_owner) then
    raise exception 'That project was not found among your projects.' using errcode = 'PT404';
  end if;
  insert into public.edit_drafts (project_id, mode, owner_id) values (p_project, p_mode, p_owner) on conflict (project_id, mode) do nothing;
  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode for update;
  if p_base is distinct from d.revision then
    raise exception 'The editor has changed since you looked (it is now at revision %). Read it again with get_edit_state and send your changes on top of that.', d.revision using errcode = 'PT409';
  end if;
  if p_mode = 'compilation' and p_actor = 'ai' and not d.ai_visible then
    raise exception 'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.' using errcode = 'PT403';
  end if;
  if p_mode = 'compilation' and p_actor = 'person' and not d.mirrored then
    raise exception 'The Ryagram app on your computer has not shared the track list with this page yet. Open it, then try again.' using errcode = 'PT403';
  end if;
  -- the limits for an AI (the person is not limited)
  if p_actor = 'ai' then
    if (select count(*) from public.edit_ops e where e.owner_id = p_owner and e.actor = 'ai' and e.created_at > now() - interval '1 minute') + n > 60 then
      raise exception 'That is more than 60 changes in a minute. Wait a minute and continue.' using errcode = 'PT429';
    end if;
    if (select count(*) from public.edit_ops e where e.owner_id = p_owner and e.actor = 'ai' and e.created_at > now() - interval '24 hours') + n > 600 then
      raise exception 'That is more than 600 changes in a day, the limit for now. Try tomorrow.' using errcode = 'PT429';
    end if;
  end if;
  -- every change is checked BEFORE any is applied (all or none)
  for o in select * from jsonb_array_elements(p_ops) loop
    i := i + 1;
    prob := ryagram_private.edit_op_problem(p_mode, o);
    if prob is not null then
      raise exception 'Change % was not accepted, and nothing was changed: %', i, prob using errcode = '22023';
    end if;
    if p_actor = 'ai' and exists (select 1 from public.edit_ops e where e.project_id = p_project and e.mode = p_mode and e.status = 'undone' and e.op = o
                                  and e.undone_at > now() - interval '10 minutes') then
      raise exception 'Change % was not accepted: the person undid exactly this a moment ago. Ask them before doing it again.', i using errcode = 'PT409';
    end if;
  end loop;
  newrev := d.revision + 1;
  st := d.state;
  look := coalesce(st -> 'look', '{}'::jsonb);
  for o in select * from jsonb_array_elements(p_ops) loop
    if p_mode = 'data' then
      kname := o ->> 'key';
      prev := look -> kname;
      if o ->> 'op' = 'set_look' then
        inv := case when prev is null then jsonb_build_object('op', 'unset_look', 'key', kname) else jsonb_build_object('op', 'set_look', 'key', kname, 'value', prev) end;
        look := look || jsonb_build_object(kname, o -> 'value');
      else
        inv := case when prev is null then null else jsonb_build_object('op', 'set_look', 'key', kname, 'value', prev) end;
        look := look - kname;
      end if;
      insert into public.edit_ops (project_id, mode, owner_id, revision, actor, client_label, op, inverse, status)
        values (p_project, p_mode, p_owner, newrev, p_actor, client, o, inv, 'applied');
    else
      insert into public.edit_ops (project_id, mode, owner_id, revision, actor, client_label, op, inverse, status)
        values (p_project, p_mode, p_owner, newrev, p_actor, client, o, null, 'pending');       -- the desktop app applies it on the person's computer
    end if;
  end loop;
  if p_mode = 'data' then st := jsonb_set(st, '{look}', look); end if;
  update public.edit_drafts set revision = newrev, state = st, updated_at = now(),
         updated_by = case when p_actor = 'ai' then coalesce(client, 'ai') else 'person' end
   where project_id = p_project and mode = p_mode;
  return jsonb_build_object('revision', newrev, 'changes', n, 'state', case when p_mode = 'data' then st else null end, 'pending', p_mode = 'compilation');
end $$;

-- Undo some ops (newest first). An op whose key a LATER applied op also changed is skipped, so undoing never clobbers newer work. Compilation ops that are still pending are simply rejected.
create function ryagram_private.undo_edit_ops(p_owner uuid, p_project uuid, p_mode text, p_ids bigint[], p_actor text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.edit_drafts;
  e public.edit_ops;
  st jsonb;
  look jsonb;
  done int := 0;
  skipped int := 0;
  newrev bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || p_mode, 2027));
  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode and owner_id = p_owner for update;
  if not found then return jsonb_build_object('undone', 0, 'skipped', 0, 'revision', 0); end if;
  st := d.state;
  look := coalesce(st -> 'look', '{}'::jsonb);
  newrev := d.revision;
  for e in select * from public.edit_ops where id = any (p_ids) and project_id = p_project and mode = p_mode and owner_id = p_owner order by id desc loop
    if e.status = 'pending' then
      update public.edit_ops set status = 'rejected', undone_at = now() where id = e.id;
      done := done + 1;
    elsif e.status = 'applied' and e.inverse is not null and p_mode = 'data' then
      if exists (select 1 from public.edit_ops l where l.project_id = p_project and l.mode = p_mode and l.id > e.id and l.status = 'applied' and l.op ->> 'key' = e.op ->> 'key') then
        skipped := skipped + 1;                                   -- a newer change to the same setting stands
      else
        if e.inverse ->> 'op' = 'set_look' then look := look || jsonb_build_object(e.inverse ->> 'key', e.inverse -> 'value'); else look := look - (e.inverse ->> 'key'); end if;
        update public.edit_ops set status = 'undone', undone_at = now() where id = e.id;
        done := done + 1;
      end if;
    else
      skipped := skipped + 1;
    end if;
  end loop;
  if done > 0 then
    newrev := newrev + 1;
    if p_mode = 'data' then st := jsonb_set(st, '{look}', look); end if;
    update public.edit_drafts set revision = newrev, state = st, updated_at = now(), updated_by = case when p_actor = 'ai' then 'ai' else 'person' end
     where project_id = p_project and mode = p_mode;
  end if;
  return jsonb_build_object('undone', done, 'skipped', skipped, 'revision', newrev, 'state', case when p_mode = 'data' then st else null end);
end $$;
revoke execute on function ryagram_private.apply_edit_ops(uuid, uuid, text, bigint, text, text, jsonb), ryagram_private.undo_edit_ops(uuid, uuid, text, bigint[], text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the person's own editor (a signed-in app session; a connector token never reaches these)
create function public.editor_apply_ops(p_project uuid, p_mode text, p_base_revision bigint, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session();
begin
  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'person', null, p_ops);
end $$;

create function public.editor_undo(p_project uuid, p_mode text, p_op_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session();
begin
  return ryagram_private.undo_edit_ops(me, p_project, p_mode, array[p_op_id], 'person');
end $$;

create function public.editor_undo_all_ai(p_project uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session(); ids bigint[];
begin
  select coalesce(array_agg(id), '{}') into ids from public.edit_ops where project_id = p_project and mode = p_mode and owner_id = me and actor = 'ai' and status in ('applied', 'pending');
  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'person');
end $$;

create function public.my_edit_ops_since(p_project uuid, p_mode text, p_revision bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session(); d public.edit_drafts;
begin
  select * into d from public.edit_drafts where project_id = p_project and mode = p_mode and owner_id = me;
  if not found then return jsonb_build_object('revision', 0, 'state', '{}'::jsonb, 'mirrored', false, 'ai_visible', false, 'ops', '[]'::jsonb); end if;
  return jsonb_build_object('revision', d.revision, 'state', d.state, 'mirrored', d.mirrored, 'ai_visible', d.ai_visible,
    'ops', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'revision', x.revision, 'actor', x.actor, 'client', x.client_label, 'op', x.op, 'status', x.status, 'at', x.created_at) order by x.id)
                       from (select * from public.edit_ops e where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.revision > p_revision order by e.id limit 200) x), '[]'::jsonb));
end $$;

create function public.editor_heartbeat(p_project uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session();
begin
  if p_mode not in ('data', 'compilation') or not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    raise exception 'That project was not found among your projects.' using errcode = 'PT404';
  end if;
  insert into public.edit_drafts (project_id, mode, owner_id, editor_seen_at) values (p_project, p_mode, me, now())
  on conflict (project_id, mode) do update set editor_seen_at = now() where public.edit_drafts.owner_id = me;
end $$;

revoke all on function public.editor_apply_ops(uuid, text, bigint, jsonb), public.editor_undo(uuid, text, bigint), public.editor_undo_all_ai(uuid, text),
  public.my_edit_ops_since(uuid, text, bigint), public.editor_heartbeat(uuid, text) from public, anon, service_role;
grant execute on function public.editor_apply_ops(uuid, text, bigint, jsonb), public.editor_undo(uuid, text, bigint), public.editor_undo_all_ai(uuid, text),
  public.my_edit_ops_since(uuid, text, bigint), public.editor_heartbeat(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the person's AI (the connector's role; the person is resolved from the token's hash on every call)
create function public.connect_edit_state(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
  dd public.edit_drafts;
  dc public.edit_drafts;
begin
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then return null; end if;
  select * into dd from public.edit_drafts where project_id = p_project and mode = 'data' and owner_id = me;
  select * into dc from public.edit_drafts where project_id = p_project and mode = 'compilation' and owner_id = me;
  return jsonb_build_object(
    'saved_story_sha256', (select v.story_sha256 from public.versions v where v.project_id = p_project order by v.number desc limit 1),
    'look_keys', (select jsonb_agg(jsonb_build_object('key', k.key, 'kind', k.kind, 'choices', k.choices, 'min', k.min_value, 'max', k.max_value) order by k.key) from public.edit_look_keys k),
    'data', jsonb_build_object('revision', coalesce(dd.revision, 0), 'look', coalesce(dd.state -> 'look', '{}'::jsonb),
                               'editor_open', coalesce(dd.editor_seen_at > now() - interval '30 seconds', false)),
    'compilation', jsonb_build_object('revision', coalesce(dc.revision, 0), 'shared', coalesce(dc.ai_visible, false),
                               'tracks', case when coalesce(dc.ai_visible, false) then dc.state else null end,
                               'pending', (select count(*) from public.edit_ops e where e.project_id = p_project and e.mode = 'compilation' and e.status = 'pending'),
                               'editor_open', coalesce(dc.editor_seen_at > now() - interval '30 seconds', false)),
    'recently_undone', coalesce((select jsonb_agg(jsonb_build_object('mode', u.mode, 'op', u.op, 'at', u.undone_at) order by u.undone_at desc)
                                   from (select * from public.edit_ops e where e.project_id = p_project and e.owner_id = me and e.status = 'undone' and e.undone_at > now() - interval '10 minutes' order by e.undone_at desc limit 20) u), '[]'::jsonb));
end $$;

create function public.connect_edit_ops(p_token_hash text, p_project uuid, p_mode text, p_base_revision bigint, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');
  label text;
begin
  select c.name into label from public.connect_tokens t join public.connect_clients c on c.client_id = t.client_id where t.access_hash = p_token_hash;
  return ryagram_private.apply_edit_ops(me, p_project, p_mode, p_base_revision, 'ai', label, p_ops);
end $$;

create function public.connect_edit_undo_ai(p_token_hash text, p_project uuid, p_mode text) returns jsonb
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

revoke all on function public.connect_edit_state(text, uuid), public.connect_edit_ops(text, uuid, text, bigint, jsonb), public.connect_edit_undo_ai(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.connect_edit_state(text, uuid), public.connect_edit_ops(text, uuid, text, bigint, jsonb), public.connect_edit_undo_ai(text, uuid, text) to connect_runner;

-- ---------------------------------------------------------------- the desktop app (the signed-in computer's role)
create function public.node_edit_pending(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'project_id', x.project_id, 'revision', x.revision, 'client', x.client_label, 'op', x.op) order by x.id)
                     from (select e.* from public.edit_ops e join public.edit_drafts d on d.project_id = e.project_id and d.mode = e.mode
                            where e.owner_id = me and e.mode = 'compilation' and e.status = 'pending' and d.mirrored order by e.id limit 100) x), '[]'::jsonb);
end $$;

-- The app posts the new TRACK SUMMARY after it applied what was pending (p_applied = [{"op_id": n, "ok": true|false}]). p_mirror false = nothing is mirrored any more: the summary is dropped and pending ops are rejected.
-- p_ai_visible = the person also ticked "let my AI see my track list" (needs p_mirror).
create function public.node_edit_post_summary(p_access_hash text, p_project uuid, p_mirror boolean, p_ai_visible boolean, p_summary jsonb, p_applied jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.node_actor(p_access_hash);
  d public.edit_drafts;
  a jsonb;
  c jsonb;
  newrev bigint;
  bad text;
begin
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then
    raise exception 'That project was not found among your projects.' using errcode = 'PT404';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || 'compilation', 2027));
  insert into public.edit_drafts (project_id, mode, owner_id) values (p_project, 'compilation', me) on conflict (project_id, mode) do nothing;
  select * into d from public.edit_drafts where project_id = p_project and mode = 'compilation' and owner_id = me for update;
  if not found then raise exception 'That project was not found among your projects.' using errcode = 'PT404'; end if;
  if not coalesce(p_mirror, false) then
    update public.edit_ops set status = 'rejected', undone_at = now() where project_id = p_project and mode = 'compilation' and owner_id = me and status = 'pending';
    update public.edit_drafts set mirrored = false, ai_visible = false, state = '{}'::jsonb, revision = d.revision + 1, updated_at = now(), updated_by = 'person' where project_id = p_project and mode = 'compilation';
    return jsonb_build_object('revision', d.revision + 1, 'mirrored', false, 'ai_visible', false);
  end if;
  -- the summary: a closed shape, names and times only
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' or pg_column_size(p_summary) > 65536 then
    raise exception 'That track summary is not valid.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_summary) k where k not in ('clips', 'overlays', 'music')) then
    raise exception 'That track summary has a part the editor does not know.' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(coalesce(p_summary -> 'clips', '[]'::jsonb)) loop
    if jsonb_typeof(c) <> 'object' or exists (select 1 from jsonb_object_keys(c) k where k not in ('id', 'label', 'file', 'in_s', 'out_s', 'start_s', 'length_s', 'candidates')) then
      raise exception 'A clip in the summary has a field the editor does not know.' using errcode = '22023';
    end if;
    if jsonb_typeof(c -> 'id') is distinct from 'string' or (c ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'A clip in the summary needs an id.' using errcode = '22023'; end if;
    if c ? 'label' and (jsonb_typeof(c -> 'label') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'label', 120)) then raise exception 'A clip label must be plain words, no places on a computer.' using errcode = '22023'; end if;
    if c ? 'file' and (jsonb_typeof(c -> 'file') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'file', 120) or (c ->> 'file') ~ '[\\/:]') then raise exception 'A clip file must be a NAME, never a place on the computer.' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_each(c) x where x.key in ('in_s', 'out_s', 'start_s', 'length_s') and jsonb_typeof(x.value) <> 'number') then raise exception 'Clip times must be numbers.' using errcode = '22023'; end if;
  end loop;
  if jsonb_array_length(coalesce(p_summary -> 'clips', '[]'::jsonb)) > 200 or jsonb_array_length(coalesce(p_summary -> 'overlays', '[]'::jsonb)) > 100 or jsonb_array_length(coalesce(p_summary -> 'music', '[]'::jsonb)) > 20 then
    raise exception 'That track summary is too long.' using errcode = '22023';
  end if;
  if p_summary::text ~ '[A-Za-z]:\\\\|\\\\\\\\' then raise exception 'A track summary holds names and times, never places on a computer.' using errcode = '22023'; end if;
  newrev := d.revision + 1;
  for a in select * from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) loop
    update public.edit_ops set status = case when (a ->> 'ok')::boolean then 'applied' else 'rejected' end, undone_at = case when (a ->> 'ok')::boolean then null else now() end
     where id = (a ->> 'op_id')::bigint and project_id = p_project and mode = 'compilation' and owner_id = me and status = 'pending';
  end loop;
  update public.edit_drafts set mirrored = true, ai_visible = coalesce(p_ai_visible, false), state = p_summary, revision = newrev, updated_at = now(), updated_by = 'person' where project_id = p_project and mode = 'compilation';
  if not coalesce(p_ai_visible, false) then
    update public.edit_ops set status = 'rejected', undone_at = now() where project_id = p_project and mode = 'compilation' and owner_id = me and actor = 'ai' and status = 'pending';   -- the person unticked: the AI's waiting changes go
  end if;
  return jsonb_build_object('revision', newrev, 'mirrored', true, 'ai_visible', coalesce(p_ai_visible, false));
end $$;

revoke all on function public.node_edit_pending(text), public.node_edit_post_summary(text, uuid, boolean, boolean, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.node_edit_pending(text), public.node_edit_post_summary(text, uuid, boolean, boolean, jsonb, jsonb) to node_runner;

-- ---------------------------------------------------------------- housekeeping (not scheduled by this file; a later ops step calls it)
-- The mirrored summary is dropped 24 hours after the editor was last open; the log keeps 7 days.
create function ryagram_private.edit_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s int; o int;
begin
  update public.edit_drafts set state = '{}'::jsonb, mirrored = false, ai_visible = false where mode = 'compilation' and (mirrored or state <> '{}'::jsonb) and coalesce(editor_seen_at, updated_at) < now() - interval '24 hours';
  get diagnostics s = row_count;
  delete from public.edit_ops where created_at < now() - interval '7 days';
  get diagnostics o = row_count;
  return jsonb_build_object('summaries_dropped', s, 'ops_deleted', o);
end $$;
revoke execute on function ryagram_private.edit_purge() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the new scope, offered on the consent page
create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit']::text[] $$;

commit;

-- THE LIVE EDITOR'S NEW CHANGES (NEXT-BUILDER 31; CONNECT's live-editor-tools 8bb6f88). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- 20261027000400_live_editor.sql is ALREADY LIVE (applied 10-28), so it is not edited: the editor's SQL twin of the op rules learns the five new changes here
-- (set_clip_style, set_music, set_rule, delete_rule, set_film_look), and the desktop app's track summary may carry rules, pictures and look, plus the clip fields
-- slide, mode, fade_s, style, level_db, fade_in_s, fade_out_s and snap. The same rules as the TypeScript and Python twins and tests/edit-op-cases.json.
-- Only the two function bodies change: same names, same arguments, same owners and grants (create or replace keeps them). No table changes.
-- Undo: supabase/rollbacks/20261029000100_live_editor_new_ops_rollback.sql. After-check: supabase/live-steps/13_live_editor_new_ops_after_check.sql.

begin;

create or replace function ryagram_private.edit_op_problem(p_mode text, p_op jsonb) returns text
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
  -- mode 'compilation': the same op names and fields as the page's editor core (WEB 152), plus add_clip (a text or picture clip; the video lane comes from the person's own videos, which the AI cannot add)
  if kind = 'move_clip' then allowed := array['op', 'id', 'start'];
  elsif kind = 'trim_clip' then allowed := array['op', 'id', 'edge', 'to'];
  elsif kind = 'reorder_clip' then allowed := array['op', 'id', 'index'];
  elsif kind = 'set_clip_text' then allowed := array['op', 'id', 'text'];
  elsif kind = 'delete_clip' then allowed := array['op', 'id'];
  elsif kind = 'add_clip' then allowed := array['op', 'track', 'start', 'len', 'text', 'picture'];
  elsif kind = 'set_clip_style' then allowed := array['op', 'id', 'style'];
  elsif kind = 'set_music' then allowed := array['op', 'level_db', 'fade_in_s', 'fade_out_s', 'source_start', 'snap'];
  elsif kind = 'set_rule' then allowed := array['op', 'id', 'phrase', 'picture', 'seconds', 'mode', 'fade_s'];
  elsif kind = 'delete_rule' then allowed := array['op', 'id'];
  elsif kind = 'set_film_look' then allowed := array['op', 'key', 'value'];
  else return format('"%s" is not a change this editor knows for a compilation.', left(kind, 40)); end if;
  if exists (select 1 from unnest(keys) x where x <> all (allowed)) then return 'That change has a field the editor does not know.'; end if;
  if kind in ('move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'set_clip_style') then
    if jsonb_typeof(p_op -> 'id') is distinct from 'string' or (p_op ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then return 'This change needs a clip "id" from get_edit_state.'; end if;
  end if;
  for k in select a as name from unnest(array['start', 'to', 'len']) a loop
    if p_op ? k.name then
      if jsonb_typeof(p_op -> k.name) <> 'number' then return format('"%s" must be a number.', k.name); end if;
    end if;
  end loop;
  if kind = 'move_clip' then
    if not (p_op ? 'start') then return 'move_clip needs "start".'; end if;
    if (p_op ->> 'start')::numeric < 0 or (p_op ->> 'start')::numeric > 86400 then return '"start" must be between 0 and 86400 seconds.'; end if;
  elsif kind = 'trim_clip' then
    if jsonb_typeof(p_op -> 'edge') is distinct from 'string' or (p_op ->> 'edge') not in ('start', 'end') then return 'Trim the "start" or the "end".'; end if;
    if not (p_op ? 'to') then return 'trim_clip needs "to".'; end if;
    if (p_op ->> 'to')::numeric < 0 or (p_op ->> 'to')::numeric > 86400 then return '"to" must be between 0 and 86400 seconds.'; end if;
  elsif kind = 'reorder_clip' then
    if jsonb_typeof(p_op -> 'index') is distinct from 'number' or (p_op ->> 'index') !~ '^[0-9]{1,3}$' then return '"index" must be a whole number from 0 to 199.'; end if;
    if (p_op ->> 'index')::int > 199 then return '"index" must be a whole number from 0 to 199.'; end if;
  elsif kind = 'set_clip_text' then
    if jsonb_typeof(p_op -> 'text') is distinct from 'string' or not ryagram_private.edit_text_ok(p_op ->> 'text', 120) then return 'The text must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).'; end if;
  elsif kind = 'add_clip' then
    if jsonb_typeof(p_op -> 'track') is distinct from 'string' or (p_op ->> 'track') not in ('text', 'pictures') then return 'The AI can add a "text" or a "pictures" clip.'; end if;
    if not (p_op ? 'start') or not (p_op ? 'len') then return 'A new clip needs "start" and "len".'; end if;
    if (p_op ->> 'start')::numeric < 0 or (p_op ->> 'start')::numeric > 3600 then return '"start" must be between 0 and 3600 seconds.'; end if;
    if (p_op ->> 'len')::numeric < 0.3 or (p_op ->> 'len')::numeric > 30 then return '"len" must be between 0.3 and 30 seconds.'; end if;
    if p_op ->> 'track' = 'text' then
      if p_op ? 'picture' or not (p_op ? 'text') then return 'A text clip needs "text" and no "picture".'; end if;
      if jsonb_typeof(p_op -> 'text') <> 'string' or not ryagram_private.edit_text_ok(p_op ->> 'text', 120) then return 'The text must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).'; end if;
    else
      if p_op ? 'text' or not (p_op ? 'picture') then return 'A picture clip needs a "picture" name and no "text".'; end if;
      if jsonb_typeof(p_op -> 'picture') <> 'string' or (p_op ->> 'picture') !~* '^[^\\/:*?"<>|[:cntrl:]]{1,100}\.(png|jpg|jpeg|webp)$' then return 'A picture is the NAME of one the person added in the app (png, jpg or webp), never a place.'; end if;
    end if;
  elsif kind = 'set_clip_style' then
    if jsonb_typeof(p_op -> 'style') is distinct from 'string' or (p_op ->> 'style') not in ('title', 'caption', 'lower_third') then return 'A text style must be title, caption or lower_third.'; end if;
  elsif kind = 'set_music' then
    if (select count(*) from jsonb_object_keys(p_op)) < 2 then return 'set_music needs at least one setting.'; end if;
    if p_op ? 'level_db' and (jsonb_typeof(p_op -> 'level_db') <> 'number' or (p_op ->> 'level_db')::numeric not between -30 and 6) then return '"level_db" must be a number from -30 to 6.'; end if;
    if p_op ? 'fade_in_s' and (jsonb_typeof(p_op -> 'fade_in_s') <> 'number' or (p_op ->> 'fade_in_s')::numeric not between 0 and 5) then return '"fade_in_s" must be a number from 0 to 5 seconds.'; end if;
    if p_op ? 'fade_out_s' and (jsonb_typeof(p_op -> 'fade_out_s') <> 'number' or (p_op ->> 'fade_out_s')::numeric not between 0 and 5) then return '"fade_out_s" must be a number from 0 to 5 seconds.'; end if;
    if p_op ? 'source_start' and (jsonb_typeof(p_op -> 'source_start') <> 'number' or (p_op ->> 'source_start')::numeric not between 0 and 86400) then return '"source_start" must be a number from 0 to 86400 seconds.'; end if;
    if p_op ? 'snap' and jsonb_typeof(p_op -> 'snap') <> 'boolean' then return '"snap" must be true or false.'; end if;
  elsif kind = 'set_rule' then
    if p_op ? 'id' and (jsonb_typeof(p_op -> 'id') <> 'string' or (p_op ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$') then return 'A rule "id" is letters, digits, - and _ (leave it out to add a new rule).'; end if;
    if jsonb_typeof(p_op -> 'phrase') is distinct from 'string' or not ryagram_private.edit_text_ok(p_op ->> 'phrase', 60) then return 'The phrase must be 1 to 60 characters of plain words (no places on a computer, no web addresses, no markup).'; end if;
    if jsonb_typeof(p_op -> 'picture') is distinct from 'string' or (p_op ->> 'picture') !~ '^[A-Za-z0-9_.-]{1,100}$' then return 'A rule needs the "picture" id from the editor state.'; end if;
    if jsonb_typeof(p_op -> 'seconds') is distinct from 'number' or (p_op ->> 'seconds')::numeric not between 0.5 and 10 then return '"seconds" must be a number from 0.5 to 10.'; end if;
    if jsonb_typeof(p_op -> 'mode') is distinct from 'string' or (p_op ->> 'mode') not in ('full', 'centre', 'corner', 'lower_third') then return 'A rule mode must be full, centre, corner or lower_third.'; end if;
    if p_op ? 'fade_s' and (jsonb_typeof(p_op -> 'fade_s') <> 'number' or (p_op ->> 'fade_s')::numeric not between 0 and 1) then return '"fade_s" must be a number from 0 to 1 second.'; end if;
  elsif kind = 'delete_rule' then
    if jsonb_typeof(p_op -> 'id') is distinct from 'string' or (p_op ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then return 'This change needs a rule "id" from get_edit_state.'; end if;
  elsif kind = 'set_film_look' then
    if jsonb_typeof(p_op -> 'key') is distinct from 'string' or (p_op ->> 'key') not in ('theme', 'text_color', 'box_color', 'box_opacity', 'letterbox') then return 'That is not a film look setting (theme, text_color, box_color, box_opacity, letterbox).'; end if;
    if not (p_op ? 'value') then return 'A film look change needs a "value".'; end if;
    if p_op ->> 'key' = 'theme' and (jsonb_typeof(p_op -> 'value') <> 'string' or (p_op ->> 'value') not in ('dark', 'light')) then return '"theme" can only be: dark, light.'; end if;
    if p_op ->> 'key' in ('text_color', 'box_color', 'letterbox') and (jsonb_typeof(p_op -> 'value') <> 'string' or (p_op ->> 'value') !~ '^#[0-9A-Fa-f]{6}$') then return format('"%s" needs a colour like #1a73e8.', p_op ->> 'key'); end if;
    if p_op ->> 'key' = 'box_opacity' and (jsonb_typeof(p_op -> 'value') <> 'number' or (p_op ->> 'value')::numeric not between 0 and 1) then return '"box_opacity" must be a number from 0 to 1.'; end if;
  end if;
  return null;
end $$;

create or replace function public.node_edit_post_summary(p_access_hash text, p_project uuid, p_mirror boolean, p_ai_visible boolean, p_summary jsonb, p_applied jsonb) returns jsonb
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
    update public.edit_ops set status = 'rejected', undone_at = now(), ended_by = 'app' where project_id = p_project and mode = 'compilation' and owner_id = me and status = 'pending';
    update public.edit_drafts set mirrored = false, ai_visible = false, state = '{}'::jsonb, revision = d.revision + 1, updated_at = now(), updated_by = 'person' where project_id = p_project and mode = 'compilation';
    return jsonb_build_object('revision', d.revision + 1, 'mirrored', false, 'ai_visible', false);
  end if;
  -- the summary: a closed shape, names and times only
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' or pg_column_size(p_summary) > 65536 then
    raise exception 'That track summary is not valid.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_summary) k where k not in ('schema', 'clips', 'duration', 'lanes', 'limits', 'rules', 'pictures', 'look')) then
    raise exception 'That track summary has a part the editor does not know.' using errcode = '22023';
  end if;
  if p_summary ? 'duration' and (jsonb_typeof(p_summary -> 'duration') <> 'number' or (p_summary ->> 'duration')::numeric < 0 or (p_summary ->> 'duration')::numeric > 86400) then
    raise exception 'The summary duration must be between 0 and 86400 seconds.' using errcode = '22023';
  end if;
  if p_summary ? 'schema' and p_summary -> 'schema' is distinct from '"ryagram.edit-tracks/0"'::jsonb then
    raise exception 'The summary schema must be ryagram.edit-tracks/0.' using errcode = '22023';
  end if;
  if p_summary ? 'rules' and (jsonb_typeof(p_summary -> 'rules') <> 'array' or jsonb_array_length(p_summary -> 'rules') > 50
       or exists (select 1 from jsonb_array_elements(p_summary -> 'rules') r
                   where jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) k where k not in ('id', 'phrase', 'picture', 'seconds', 'mode', 'fade_s'))
                      or jsonb_typeof(r -> 'id') is distinct from 'string' or (r ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$'
                      or jsonb_typeof(r -> 'phrase') is distinct from 'string' or not ryagram_private.edit_text_ok(r ->> 'phrase', 60)
                      or jsonb_typeof(r -> 'picture') is distinct from 'string' or (r ->> 'picture') !~ '^[A-Za-z0-9_.-]{1,100}$'
                      or jsonb_typeof(r -> 'seconds') is distinct from 'number' or (r ->> 'seconds')::numeric not between 0.5 and 10
                      or jsonb_typeof(r -> 'mode') is distinct from 'string' or (r ->> 'mode') not in ('full', 'centre', 'corner', 'lower_third')
                      or (r ? 'fade_s' and (jsonb_typeof(r -> 'fade_s') <> 'number' or (r ->> 'fade_s')::numeric not between 0 and 1)))) then
    raise exception 'The summary rules must be up to 50 rules with a phrase, a picture id, seconds and a mode.' using errcode = '22023';
  end if;
  if p_summary ? 'pictures' and (jsonb_typeof(p_summary -> 'pictures') <> 'array' or jsonb_array_length(p_summary -> 'pictures') > 50
       or exists (select 1 from jsonb_array_elements(p_summary -> 'pictures') r
                   where jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) k where k not in ('id', 'name'))
                      or jsonb_typeof(r -> 'id') is distinct from 'string' or (r ->> 'id') !~ '^[A-Za-z0-9_.-]{1,100}$'
                      or jsonb_typeof(r -> 'name') is distinct from 'string' or not ryagram_private.edit_text_ok(r ->> 'name', 100) or (r ->> 'name') ~ '[:/]' or position(chr(92) in (r ->> 'name')) > 0)) then
    raise exception 'The summary pictures must be up to 50 names with an id: a NAME, never a place on the computer.' using errcode = '22023';
  end if;
  if p_summary ? 'look' and (jsonb_typeof(p_summary -> 'look') <> 'object' or exists (select 1 from jsonb_each(p_summary -> 'look') x
       where x.key not in ('theme', 'text_color', 'box_color', 'box_opacity', 'letterbox')
          or (x.key = 'theme' and (jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') not in ('dark', 'light')))
          or (x.key in ('text_color', 'box_color', 'letterbox') and (jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$'))
          or (x.key = 'box_opacity' and (jsonb_typeof(x.value) <> 'number' or (x.value #>> '{}')::numeric not between 0 and 1)))) then
    raise exception 'The summary look must use theme, text_color, box_color, box_opacity and letterbox.' using errcode = '22023';
  end if;
  if p_summary ? 'lanes' and (jsonb_typeof(p_summary -> 'lanes') <> 'array' or jsonb_array_length(p_summary -> 'lanes') > 4
       or exists (select 1 from jsonb_array_elements(p_summary -> 'lanes') l where jsonb_typeof(l) <> 'string' or (l #>> '{}') not in ('video', 'pictures', 'text', 'music'))) then
    raise exception 'The summary lanes must be video, pictures, text or music.' using errcode = '22023';
  end if;
  if p_summary ? 'limits' and (jsonb_typeof(p_summary -> 'limits') <> 'object' or (select count(*) from jsonb_object_keys(p_summary -> 'limits')) > 10
       or exists (select 1 from jsonb_each(p_summary -> 'limits') x
                   where x.key !~ '^[a-z_]{1,30}$'
                      or not (jsonb_typeof(x.value) = 'number'
                              or (jsonb_typeof(x.value) = 'object' and (select count(*) from jsonb_object_keys(x.value)) <= 6
                                  and not exists (select 1 from jsonb_each(x.value) y where y.key !~ '^[a-z_]{1,30}$' or jsonb_typeof(y.value) <> 'number'))))) then
    raise exception 'The summary limits must be named numbers.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_summary -> 'clips', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_summary -> 'clips', '[]'::jsonb)) > 300 then
    raise exception 'That track summary is too long.' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(coalesce(p_summary -> 'clips', '[]'::jsonb)) loop
    if jsonb_typeof(c) <> 'object' or exists (select 1 from jsonb_object_keys(c) k where k not in ('id', 'track', 'start', 'len', 'label', 'text', 'picture', 'file', 'source', 'source_start', 'min_len', 'max_len', 'position', 'size', 'ai_altered', 'ai_altered_by', 'ai_altered_derived', 'slide', 'mode', 'fade_s', 'style', 'level_db', 'fade_in_s', 'fade_out_s', 'snap')) then
      raise exception 'A clip in the summary has a field the editor does not know.' using errcode = '22023';
    end if;
    if jsonb_typeof(c -> 'id') is distinct from 'string' or (c ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'A clip in the summary needs an id.' using errcode = '22023'; end if;
    if jsonb_typeof(c -> 'track') is distinct from 'string' or (c ->> 'track') not in ('video', 'pictures', 'text', 'music') then raise exception 'A clip must be on the video, pictures, text or music track.' using errcode = '22023'; end if;
    if jsonb_typeof(c -> 'start') is distinct from 'number' or jsonb_typeof(c -> 'len') is distinct from 'number' then raise exception 'Clip times must be numbers.' using errcode = '22023'; end if;
    if c ? 'label' and (jsonb_typeof(c -> 'label') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'label', 120)) then raise exception 'A clip label must be plain words, no places on a computer.' using errcode = '22023'; end if;
    if c ? 'text' and (jsonb_typeof(c -> 'text') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'text', 200)) then raise exception 'Clip text must be plain words, no places on a computer.' using errcode = '22023'; end if;
    if c ? 'picture' and (jsonb_typeof(c -> 'picture') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'picture', 100) or (c ->> 'picture') ~ '[\\/:]') then raise exception 'A picture is a NAME, never a place on the computer.' using errcode = '22023'; end if;
    if c ? 'source' and (jsonb_typeof(c -> 'source') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'source', 120) or (c ->> 'source') ~ '[\\/:]') then raise exception 'A clip source must be a NAME, never a place on the computer.' using errcode = '22023'; end if;
    if exists (select 1 from unnest(array['source_start', 'min_len', 'max_len']) f where c ? f and (jsonb_typeof(c -> f) <> 'number' or (c ->> f)::numeric not between 0 and 86400)) then raise exception 'A clip time must be a number from 0 to 86400 seconds.' using errcode = '22023'; end if;
    if c ? 'position' and (jsonb_typeof(c -> 'position') <> 'string' or (c ->> 'position') not in ('top', 'centre', 'bottom', 'lower_third')) then raise exception 'A clip position must be top, centre, bottom or lower_third.' using errcode = '22023'; end if;
    if c ? 'size' and (jsonb_typeof(c -> 'size') <> 'string' or (c ->> 'size') not in ('small', 'medium', 'large')) then raise exception 'A clip size must be small, medium or large.' using errcode = '22023'; end if;
    if c ? 'level_db' and (jsonb_typeof(c -> 'level_db') <> 'number' or (c ->> 'level_db')::numeric not between -30 and 6) then raise exception 'level_db must be a number from -30 to 6.' using errcode = '22023'; end if;
    if c ? 'fade_in_s' and (jsonb_typeof(c -> 'fade_in_s') <> 'number' or (c ->> 'fade_in_s')::numeric not between 0 and 5) then raise exception 'fade_in_s must be a number from 0 to 5.' using errcode = '22023'; end if;
    if c ? 'fade_out_s' and (jsonb_typeof(c -> 'fade_out_s') <> 'number' or (c ->> 'fade_out_s')::numeric not between 0 and 5) then raise exception 'fade_out_s must be a number from 0 to 5.' using errcode = '22023'; end if;
    if c ? 'snap' and jsonb_typeof(c -> 'snap') <> 'boolean' then raise exception 'snap must be true or false.' using errcode = '22023'; end if;
    if c ? 'style' and (jsonb_typeof(c -> 'style') <> 'string' or (c ->> 'style') not in ('title', 'caption', 'lower_third')) then raise exception 'A text style must be title, caption or lower_third.' using errcode = '22023'; end if;
    if c ? 'slide' and jsonb_typeof(c -> 'slide') <> 'boolean' then raise exception 'slide must be true or false.' using errcode = '22023'; end if;
    if c ? 'mode' and (jsonb_typeof(c -> 'mode') <> 'string' or (c ->> 'mode') not in ('full', 'centre', 'corner', 'lower_third')) then raise exception 'A picture mode must be full, centre, corner or lower_third.' using errcode = '22023'; end if;
    if c ? 'fade_s' and (jsonb_typeof(c -> 'fade_s') <> 'number' or (c ->> 'fade_s')::numeric not between 0 and 1) then raise exception 'A fade must be a number from 0 to 1 second.' using errcode = '22023'; end if;
    if c ? 'ai_altered' and jsonb_typeof(c -> 'ai_altered') <> 'boolean' then raise exception 'ai_altered must be true or false.' using errcode = '22023'; end if;
    if c ? 'ai_altered_derived' and jsonb_typeof(c -> 'ai_altered_derived') <> 'boolean' then raise exception 'ai_altered_derived must be true or false.' using errcode = '22023'; end if;
    if c ? 'ai_altered_by' and (jsonb_typeof(c -> 'ai_altered_by') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'ai_altered_by', 200)) then raise exception 'ai_altered_by must be plain words.' using errcode = '22023'; end if;
    if c ? 'file' and (jsonb_typeof(c -> 'file') <> 'string' or not ryagram_private.edit_text_ok(c ->> 'file', 120) or (c ->> 'file') ~ '[\\/:]') then raise exception 'A clip file must be a NAME, never a place on the computer.' using errcode = '22023'; end if;
  end loop;
  newrev := d.revision + 1;
  for a in select * from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) loop
    update public.edit_ops set status = case when (a ->> 'ok')::boolean then 'applied' else 'rejected' end, undone_at = case when (a ->> 'ok')::boolean then null else now() end, ended_by = case when (a ->> 'ok')::boolean then null else 'app' end
     where id = (a ->> 'op_id')::bigint and project_id = p_project and mode = 'compilation' and owner_id = me and status = 'pending';
  end loop;
  update public.edit_drafts set mirrored = true, ai_visible = coalesce(p_ai_visible, false), state = p_summary, revision = newrev, updated_at = now(), updated_by = 'person' where project_id = p_project and mode = 'compilation';
  if not coalesce(p_ai_visible, false) then
    update public.edit_ops set status = 'rejected', undone_at = now(), ended_by = 'app' where project_id = p_project and mode = 'compilation' and owner_id = me and actor = 'ai' and status = 'pending';   -- the person unticked: the AI's waiting changes go
  end if;
  return jsonb_build_object('revision', newrev, 'mirrored', true, 'ai_visible', coalesce(p_ai_visible, false));
end $$;

commit;

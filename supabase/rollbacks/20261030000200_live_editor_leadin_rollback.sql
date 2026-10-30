-- MORE LEAD-IN ON THE FIRST VIDEO CLIP: the exact undo of migrations/20261030000200_live_editor_leadin.sql (NEXT-WEB 180). NOT a migration: nothing applies it by itself; Ryan runs it only to go back.
-- Puts ryagram_private.edit_op_problem back exactly as 20261029000100_live_editor_new_ops.sql made it (a negative `to` is refused again).

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

commit;

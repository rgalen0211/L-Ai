-- LOOK KEYS text.scale AND layout.legend_position (ENGINE branch engine-style-keys-1127, paired L-Ai branch engine-style-keys-lai-1127).
-- NOT APPLIED: a live step for Ryan's yes. Do not apply before the engine branch is merged and the worker runs it: a worker that does not know the keys refuses a story that carries them.
-- Rollback: supabase/rollbacks/20261127000100_look_keys_text_scale_legend_position_rollback.sql (outside migrations/, so nothing applies it by accident).
--
-- WHAT IT DOES: adds two rows to public.edit_look_keys (the table 20261027000400_live_editor.sql made; its applied file is NOT edited, as its own comment says new keys arrive as a reviewed insert):
--   text.scale             number 0.85 to 1.0   (sequence.style_overrides.text.scale: smaller type only; 1.0 = the film's own size)
--   layout.legend_position enum bottom_left | bottom_right   (sequence.style_overrides.layout.legend_position; state and county map views only: the worker refuses it on other views)
-- The same two keys are in edit_state.ts LOOK_KEYS, assets/app-editor-core.js, tools/maker_live.py and the worker schema (a test fails if the lists disagree).
-- Safe to rerun: a key already there is left as it is. Touches nothing else; no function is redefined (connect_edit_ops reads the table).
begin;
insert into public.edit_look_keys (key, kind, choices, min_value, max_value, stand_in) values
  ('text.scale', 'number', null, 0.85, 1.0, false),
  ('layout.legend_position', 'enum', array['bottom_left', 'bottom_right'], null, null, false)
on conflict (key) do nothing;
commit;

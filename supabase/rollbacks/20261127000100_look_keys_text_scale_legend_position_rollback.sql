-- THE EXACT UNDO of migrations/20261127000100_look_keys_text_scale_legend_position.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It removes the two look keys text.scale and layout.legend_position from public.edit_look_keys. A draft that already holds either key keeps its value in its state, but the editor's checks refuse a new set of it.
begin;
delete from public.edit_look_keys where key in ('text.scale', 'layout.legend_position');
commit;

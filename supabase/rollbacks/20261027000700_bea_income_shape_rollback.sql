-- The exact undo of migrations/20261027000700_bea_income_shape.sql (Q296 B). NOT a migration: nothing applies it by itself.
-- It removes the one price-shape row that migration added for bea_sainc1_state_income_index, and only that row (noted_by starts with 'Q291'). credit_quote then refuses that dataset again, as before.
begin;
do $$
begin
  if to_regclass('public.credit_dataset_shapes') is not null then
    delete from public.credit_dataset_shapes where dataset = 'bea_sainc1_state_income_index' and noted_by like 'Q291%';
  end if;
end $$;
commit;

-- Credit shape for the state income index (WORKER, 2026-10-27; Q291, Ryan's typed yes 2026-10-27 15:57).
--
-- Q291 put bea_sainc1_state_income_index on the installed worker's allowlist after its default film passed the strict
-- motion check, so the catalog now marks it usable; credit_quote refuses a dataset with no public.credit_dataset_shapes
-- row. The engine's DatasetSpec.shape for it is 'areas' (read at Ryagram f170ab2, the installed worker's engine), which is
-- 'standard' by the 2026-09-28 rule, the same as the five priced in 20261017000800_dataset_shapes.sql.
-- phase-2b/credits_ledger.sql now seeds it too; this file is for a database where that file was applied before (live).
-- It does nothing if the table does not exist yet. Safe to run more than once. Checked by
-- supabase/tests/test_dataset_shapes.py.

do $$
begin
  if to_regclass('public.credit_dataset_shapes') is not null then
    insert into public.credit_dataset_shapes (dataset, shape, noted_by) values
      ('bea_sainc1_state_income_index', 'standard', 'Q291 2026-10-27: DatasetSpec.shape areas')
    on conflict (dataset) do nothing;
  end if;
end $$;

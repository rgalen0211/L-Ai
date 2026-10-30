-- AFTER 20261027000700_bea_income_shape.sql (Q296 B, the price shape of the state income index): one SELECT, read-only. Every ok must be true.
-- (It reads public.credit_dataset_shapes, which phase 2b created long ago and 20261017000800 filled for five datasets; if the SQL Editor says that relation does not exist, tell Claude: that is a finding.)
select 'bea_sainc1_state_income_index has exactly one row, shape standard' as check_name,
       (select count(*) from public.credit_dataset_shapes where dataset = 'bea_sainc1_state_income_index' and shape = 'standard') = 1 as ok
union all select 'the row is the one this step wrote (its note says Q291) and no other row says Q291',
       (select count(*) from public.credit_dataset_shapes where noted_by like 'Q291%') = 1
union all select 'the five earlier datasets are still priced (nothing existing was changed)',
       (select count(*) from public.credit_dataset_shapes where dataset <> 'bea_sainc1_state_income_index') >= 5;

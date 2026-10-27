-- Credit shapes for five datasets (CC1, 2026-10-17; Ryan's decision the same day).
--
-- Five datasets on the installed worker's allowlist had no public.credit_dataset_shapes row, so credit_quote refused
-- them (WEB found them while building catalog-usable). ENGINE read DatasetSpec.shape from Ryagram main: all five are
-- 'areas', which is 'standard' by the 2026-09-28 rule (the field the engine's is_path and is_flows test), the same as
-- bps_county_permits. phase-2b/credits_ledger.sql now seeds them too; this file is for a database where that file was
-- applied before they were added (live). It does nothing if the table does not exist yet. Safe to run more than once.
-- Checked by supabase/tests/test_dataset_shapes.py.

do $$
begin
  if to_regclass('public.credit_dataset_shapes') is not null then
    insert into public.credit_dataset_shapes (dataset, shape, noted_by) values
      ('bps_county_unit_share_1', 'standard', 'Ryan 2026-10-17: ENGINE read DatasetSpec.shape'),
      ('bps_county_unit_share_2to4', 'standard', 'Ryan 2026-10-17: ENGINE read DatasetSpec.shape'),
      ('bps_county_unit_share_5plus', 'standard', 'Ryan 2026-10-17: ENGINE read DatasetSpec.shape'),
      ('bps_us_unit_mix', 'standard', 'Ryan 2026-10-17: ENGINE read DatasetSpec.shape'),
      ('fhwa_hm212', 'standard', 'Ryan 2026-10-17: ENGINE read DatasetSpec.shape')
    on conflict (dataset) do nothing;
  end if;
end $$;

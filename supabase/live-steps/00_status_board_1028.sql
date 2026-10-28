-- STATUS BOARD for the six live steps of 2026-10-28: one SELECT, read-only, nothing is changed. Paste it into the SQL Editor of the live project at any time.
-- One row per database step: applied = true means that step's objects are already there. Run it first (every row should be false except what you already did), and again after each step.
-- (Row 3 reads public.credit_dataset_shapes, which phase 2b created long ago; if the board says that relation does not exist, tell Claude: that is a finding, not a step.)
-- (The older nine steps of 2026-10-27 have their own board, 00_status_board.sql.)
select step, applied from (
  select 1 as n, 'Q279   20261027000400 live editor (the AI half)' as step, to_regclass('public.edit_drafts') is not null as applied
  union all select 2, 'Q297   20261027000500 download plans', to_regclass('public.download_plans') is not null
  union all select 3, 'Q296 B 20261027000700 price shape of the state income index', exists (select 1 from public.credit_dataset_shapes where dataset = 'bea_sainc1_state_income_index')
  union all select 4, 'Q302 B 20261027000800 invite email sent by Ryagram', to_regclass('public.invite_sends') is not null
  union all select 5, 'Q301 B 20261027000900 Connect-an-AI switch on the admin page', to_regclass('public.connect_access_audit') is not null
  union all select 6, 'Q307   20261027001100 render state for the connected AI', to_regprocedure('public.connect_rendering_state(text)') is not null
) s order by n;

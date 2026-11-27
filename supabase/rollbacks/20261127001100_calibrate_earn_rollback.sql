-- THE EXACT UNDO of migrations/20261127001100_calibrate_earn.sql (revision 3). NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It REFUSES, in words, while any award is HELD (made, not yet released, not reversed): those are credits people were told are coming. Release them
--   (ryagram_private.calibrate_release_due()) or undo them (ryagram_private.calibrate_award_undo(id, note)) first, or copy them out and decide.
-- It also refuses while anyone holds tenths or a calibrate debt in ryagram_private.calibrate_points (not zero): dropping them would silently forget part of a credit or a debt.
-- Otherwise it drops the six page calls, the connector's status read, every private calibrate function, the rules, the task kinds, the consent words, the items (with their gold answers),
--   the rounds, the round items, the media handles, the answers, the award ledger, the releases, the credit moves, the consents, the points, the budget,
--   and the master switch column ops_settings.calibrate_enabled. Credits already GRANTED and TAKEN BACK STAY in the credit ledger (append-only; nobody's balance changes).
-- WARNING: this forgets every answer and every consent. To keep them, copy them out first
--   (select * from public.calibrate_answers / calibrate_awards / calibrate_releases / calibrate_credit_moves / calibrate_consents).
-- The per-account switch name 'calibrate' may stay in account_settings.switches_on: with these calls gone it opens nothing. Ends with gate_apply.
begin;
do $$
declare n int; t int;
begin
  select count(*) into n from public.calibrate_awards w
   where w.kind = 'award'
     and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
     and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id);
  if n > 0 then
    raise exception 'Calibrate cannot be removed: % award(s) are still held for people. Release or undo them first, then run this again.', n using errcode = '55000';
  end if;
  select count(*) into t from ryagram_private.calibrate_points p where p.tenths <> 0;
  if t > 0 then
    raise exception 'Calibrate cannot be removed: % account(s) hold part of a credit or a calibrate debt. Decide them first (dashboard), then run this again.', t using errcode = '55000';
  end if;
end $$;
drop function public.connect_calibration_status(text);
drop function public.my_calibration_undo(uuid);
drop function public.my_calibration_earned_get();
drop function public.my_calibration_answer_set(text, text, text);
drop function public.my_calibration_round_get();
drop function public.my_calibration_consent_set(boolean, text);
drop function public.my_calibration_consent_get();
drop function ryagram_private.calibrate_award_undo(bigint, text);
drop function ryagram_private.calibrate_round_json(uuid);
drop function ryagram_private.calibrate_round_close(uuid, boolean);
drop function ryagram_private.calibrate_release_due();
drop function ryagram_private.calibrate_release_owner(uuid);
drop function ryagram_private.calibrate_cancel_held(uuid, text);
drop function ryagram_private.calibrate_cap(uuid);
drop function ryagram_private.calibrate_gold_ok(uuid, uuid);
drop function ryagram_private.calibrate_person();
drop function ryagram_private.calibrate_refuse_connector();
drop function ryagram_private.calibrate_paused(uuid);
drop function ryagram_private.calibrate_eligible(uuid);
drop function ryagram_private.calibrate_gate(uuid);
drop function ryagram_private.calibrate_consented(uuid);
drop function ryagram_private.calibrate_switch_on(uuid);
drop function ryagram_private.calibrate_master_on();
drop table public.calibrate_credit_moves;
drop table public.calibrate_releases;
drop table public.calibrate_awards;
drop function ryagram_private.calibrate_append_only();
drop table public.calibrate_answers;
drop table ryagram_private.calibrate_media_handles;
drop table ryagram_private.calibrate_round_items;
drop table public.calibrate_rounds;
drop table public.calibrate_consents;
drop table ryagram_private.calibrate_points;
drop table ryagram_private.calibrate_budget;
drop table ryagram_private.calibrate_items;
drop table ryagram_private.calibrate_consent_words;
drop table ryagram_private.calibrate_task_kinds;
drop table ryagram_private.calibrate_rules;
alter table public.ops_settings drop column calibrate_enabled;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;

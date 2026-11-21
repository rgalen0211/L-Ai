-- THE DAILY CONNECTOR PURGE ALSO RUNS THE PREPARED-DATA PURGE (CONNECT, 2026-11-21; GEO's 12:00 review, MEDIUM 1). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. UNRUN against a database (the Postgres lane waits for disk; see the header of the test).
-- Why: 20261120000500_prepared_data.sql defines ryagram_private.prepared_purge() (delete a waiting table 7 days after it arrived, an accepted or discarded one a day after it was decided) and says nothing calls it yet. Nothing did, so an expired waiting
-- table kept its full CSV text in public.prepared_data for ever (only hidden), and accepted and discarded rows stayed. The Privacy page will say a handed-over table is gone after 7 days, so this makes it true.
-- What it changes: ONE live function, public.connect_purge() (the daily pg_cron job; the same name, arguments, owner and grants, because create or replace keeps them). It is 20261120000100_connect_purge_edit.sql's function (same deletes, same four counts, the
-- editor purge call) PLUS one guarded call to prepared_purge() (skipped when that function does not exist, and a failing prepared purge can never stop the purge above it), and ONE new key in the answer, 'prepared' (the number of rows removed).
-- Order: after 20261120000100 and 20261120000500; it is a superset of the first, so it is safe even if only one of them is applied (each call is skipped without its function). Undo: supabase/rollbacks/20261120000600_prepared_purge_daily_rollback.sql. After-check: supabase/live-steps/38_prepared_purge_after_check.sql.
-- Why a new file and not an edit of 20261120000500: that file is the lane proven 11 of 11 on a real Postgres and stays byte for byte as it was.

begin;

create or replace function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e jsonb := null; f jsonb := null;
begin
  delete from public.connect_requests where expires_at < now() - interval '1 day'; get diagnostics a = row_count;
  delete from public.connect_codes where expires_at < now() - interval '1 day'; get diagnostics b = row_count;
  delete from public.connect_tokens where refresh_expires_at < now() - interval '1 day'; get diagnostics c = row_count;      -- rotated rows stay until expiry so reuse is still detected
  delete from public.connect_calls where at < now() - interval '30 days'; get diagnostics d = row_count;
  delete from public.connect_buckets where window_start < now() - interval '2 days';
  -- clients that registered but nobody ever signed in to (DCR is open): gone after a week
  delete from public.connect_clients c where c.created_at < now() - interval '7 days'
    and not exists (select 1 from public.connect_grants g where g.client_id = c.client_id)
    and not exists (select 1 from public.connect_tokens t where t.client_id = c.client_id);
  -- the live editor's own retention (20261027000400): mirrored track summaries 24 hours after the editor was last open, the edit log after 7 days
  if to_regprocedure('ryagram_private.edit_purge()') is not null then
    begin
      execute 'select ryagram_private.edit_purge()' into e;
    exception when others then
      e := jsonb_build_object('error', sqlstate);          -- a failing editor purge must NEVER stop the daily connector purge above it (RENDERER's review of 11-20): the answer says it failed, the other deletes stand
    end;
  end if;
  -- AI-prepared tables (20261120000500): a waiting table goes 7 days after it arrived, an accepted or discarded one a day after it was decided (its text was already emptied at once). Without this call an expired table keeps its full text in the database for ever, only hidden (GEO 11-21).
  if to_regprocedure('ryagram_private.prepared_purge()') is not null then
    begin
      execute 'select to_jsonb(ryagram_private.prepared_purge())' into f;
    exception when others then
      f := jsonb_build_object('error', sqlstate);          -- a failing prepared purge must NEVER stop the daily connector purge above it, and its answer says it failed
    end;
  end if;
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e, 'prepared', f);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (connect_purge is for the database owner and the dashboard only, so the gate leaves it as it is)

commit;

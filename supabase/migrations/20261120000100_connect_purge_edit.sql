-- THE DAILY CONNECTOR PURGE ALSO RUNS THE LIVE EDITOR'S PURGE (CONNECT audit, 2026-11-20). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES ONE LIVE FUNCTION (public.connect_purge). UNRUN against a database: written and read, not executed.
-- Why: 20261027000400_live_editor.sql promises that the track summary the desktop app mirrors for the person's AI (clip names and times) "is dropped 24 hours after the editor was last open" and that the edit log "keeps 7 days".
-- Both promises live in ryagram_private.edit_purge(), which that migration revokes from every API role and says "a later ops step calls it". Nothing ever did: no migration, no cron step and no Edge Function names it
-- (grep the repository for edit_purge: only its own definition, its tests and the after-check), so a mirrored track summary stays in public.edit_drafts and every op stays in public.edit_ops for ever.
-- The one purge that IS scheduled is public.connect_purge() (a daily pg_cron job, supabase/connect-live/05b_purge_last_run.sql checks it runs). This file makes that function ALSO call edit_purge(), when the live editor is installed.
-- Everything else in connect_purge is as 20261018000100_connect_ai.sql left it (same deletes, same four counts, same keys); ONE key is added to the answer, 'edit' (what edit_purge answered: summaries_dropped, ops_deleted; null where the live editor is not installed).
-- Same name, same arguments, same owner and grants (create or replace keeps them: nobody but the database owner and the dashboard can run it). Summaries are therefore dropped between 24 and 48 hours after the editor was last open (the job runs once a day).
-- Needs 20261018000100_connect_ai.sql. Uses 20261027000400_live_editor.sql when it is applied (the call is skipped without it, so the file is safe in either order).
-- Undo: supabase/rollbacks/20261120000100_connect_purge_edit_rollback.sql. After-check: supabase/live-steps/30_connect_purge_edit_after_check.sql.

begin;

create or replace function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e jsonb := null;
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
    execute 'select ryagram_private.edit_purge()' into e;
  end if;
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (connect_purge is for the database owner and the dashboard only, so the gate leaves it as it is)

commit;

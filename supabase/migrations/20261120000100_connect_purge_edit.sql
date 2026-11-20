-- THE DAILY CONNECTOR PURGE ALSO RUNS THE LIVE EDITOR'S PURGE (CONNECT audit, 2026-11-20). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES ONE LIVE FUNCTION (public.connect_purge). UNRUN against a database: written and read, not executed.
-- Why: 20261027000400_live_editor.sql promises that the track summary the desktop app mirrors for the person's AI (clip names and times) "is dropped 24 hours after the editor was last open" and that the edit log "keeps 7 days".
-- Both promises live in ryagram_private.edit_purge(), which that migration revokes from every API role and says "a later ops step calls it". Nothing ever did: no migration, no cron step and no Edge Function names it
-- (grep the repository for edit_purge: only its own definition, its tests and the after-check), so a mirrored track summary stays in public.edit_drafts and every op stays in public.edit_ops for ever.
-- The one purge that IS scheduled is public.connect_purge() (a daily pg_cron job, supabase/connect-live/05b_purge_last_run.sql checks it runs). This file makes that function ALSO call edit_purge(), when the live editor is installed.
-- Everything else in connect_purge is as 20261018000100_connect_ai.sql left it (same deletes, same four counts, same keys); ONE key is added to the answer, 'edit' (what edit_purge answered: summaries_dropped, ops_deleted; null where the live editor is not installed).
-- Same name, same arguments, same owner and grants (create or replace keeps them: nobody but the database owner and the dashboard can run it). Summaries are therefore dropped between 24 and 48 hours after the editor was last open (the job runs once a day).
-- Needs 20261018000100_connect_ai.sql. Uses 20261027000400_live_editor.sql when it is applied (the call is skipped without it, so the file is safe in either order).
-- Undo: supabase/rollbacks/20261120000100_connect_purge_edit_rollback.sql. After-check: supabase/live-steps/30_connect_purge_edit_after_check.sql.
-- APPLY NOTE FOR RYAN (CC1's deep review of 11-20, LOW 3, so this file does not surprise anyone): applying it switches edit_purge on FOR THE FIRST TIME, and edit_purge DELETES DATA on the live database: within a day, any
-- compilation draft whose web editor was last opened more than 24 hours ago loses its mirrored track list and its "AI can see it" setting, EVEN IF the desktop app posted a new list an hour earlier (edit_purge compares the editor-open
-- time, coalesce(editor_seen_at, updated_at), not the app's last post); the draft's revision does not change, so a client sees nothing and waiting edits stay pending until the app posts again. That is what the 24-hour promise in
-- 20261027000400 says, but nobody has ever run it. THE FIRST RUN ALSO DELETES every public.edit_ops row older than 7 days: the whole edit-log backlog since the live editor began (edit_purge in 20261027000400_live_editor.sql), in one go. Those rows also hold the AI's re-apply guard (a change the person undid is not applied again: status undone or rejected, ended_by person, live_editor line 237), so that guard and the person's undo history vanish after 7 days; that is the promise the live-editor migration makes, nobody ran it before. Before applying: decide whether to also (a) bump the revision and reject waiting edits when a draft is cleared, and (b) count the app's last post as activity; neither is done here
-- (unrun SQL is kept to the least change). Also: the network-only host list in the plan-asks migration (20261120000200) is a name rule only; a public name that resolves to a private address (127.0.0.1.nip.io) passes it, and names such as
-- home.arpa, localdomain, corp and intranet are not listed: the desktop app's own address check at download time is the real guard, this is the first one.

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
    begin
      execute 'select ryagram_private.edit_purge()' into e;
    exception when others then
      e := jsonb_build_object('error', sqlstate);          -- a failing editor purge must NEVER stop the daily connector purge above it (RENDERER's review of 11-20): the answer says it failed, the other deletes stand
    end;
  end if;
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (connect_purge is for the database owner and the dashboard only, so the gate leaves it as it is)

commit;

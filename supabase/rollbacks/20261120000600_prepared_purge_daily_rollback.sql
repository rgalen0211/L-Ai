-- THE DAILY CONNECTOR PURGE ALSO RUNS THE PREPARED-DATA PURGE: the exact undo of migrations/20261120000600_prepared_purge_daily.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/.
-- It puts public.connect_purge() back as 20261120000100_connect_purge_edit.sql defined it (the editor purge call, no call to prepared_purge, no 'prepared' key). Nothing is deleted or restored by it: tables already purged stay purged.
-- If 20261120000100 was never applied, run its own rollback (rollbacks/20261120000100_connect_purge_edit_rollback.sql) afterwards to get back to the original.
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

commit;

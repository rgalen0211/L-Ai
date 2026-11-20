-- THE DAILY CONNECTOR PURGE AND THE LIVE EDITOR'S PURGE: the exact undo of migrations/20261120000100_connect_purge_edit.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by itself. UNRUN against a database.
-- It puts public.connect_purge() back as 20261018000100_connect_ai.sql defined it (no call to ryagram_private.edit_purge(), no 'edit' key). Nothing is deleted or restored by it: rows the live editor's purge already removed stay removed.
begin;

create or replace function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int;
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
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d);
end $$;

commit;

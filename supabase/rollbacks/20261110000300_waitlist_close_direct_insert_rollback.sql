-- THE WAITING LIST: the exact undo of migrations/20261110000300_waitlist_close_direct_insert.sql (CONNECT, 2026-11-10). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It reopens the direct table insert exactly as ryagram-waitlist.sql made it (insert-only, the three columns the old form sends, only for rows with no user and no invite). Use it only if the page has to go back to its direct insert.
begin;
grant insert (email, use_case, source) on table public.ryagram_waitlist to anon, authenticated;
drop policy if exists "Visitors can join the waitlist" on public.ryagram_waitlist;
create policy "Visitors can join the waitlist"
  on public.ryagram_waitlist for insert
  to anon, authenticated
  with check (user_id is null and invited_at is null);
commit;

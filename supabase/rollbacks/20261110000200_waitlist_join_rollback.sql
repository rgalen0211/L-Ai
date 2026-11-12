-- THE WAITING LIST'S DATABASE HALF: the exact undo of migrations/20261110000200_waitlist_join.sql (CONNECT, 2026-11-10). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- Switch the page back to its direct insert first (or it will be told the function is gone). The list itself (ryagram_waitlist, its rows and addresses) is untouched; what is lost is the approved marks and Ryan's approve history.
begin;
drop function if exists public.join_waitlist(text, text, text);
drop function if exists public.admin_waitlist_counts();
drop function if exists public.admin_waitlist_approve(int);
drop table if exists public.ryagram_waitlist_hits;
drop table if exists public.ryagram_waitlist_approvals;
alter table public.ryagram_waitlist drop column if exists approved_at, drop column if exists approved_by;
commit;
